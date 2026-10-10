/**
 * Pure queue-batch planner. Given the unseen catalog, user signals, interest
 * clusters and whatever embedding vectors are available, produce one ranked,
 * diversified, explained batch of queue items.
 *
 * Everything Convex-specific (vectorSearch, persistence) stays in `queue.ts`;
 * this module is fully unit-testable and reused by the offline harness.
 */
import {
  GEN_BATCH,
  GEN_EXPLORE_SEEDS,
  GEN_FRESH_CAP,
  GEN_LONGTAIL_CAP,
  GEN_POOL,
  GEN_TOPIC_CAP,
  SEMANTIC_WEIGHTS,
  type RankingWeights,
} from "./constants";
import {
  dedupeSourced,
  freshRepos,
  longTailRepos,
  tagSources,
  topicMatchedRepos,
  type SourcedRepo,
} from "./candidates";
import { selectExploration } from "./exploration";
import { explainCandidate } from "./explain";
import { interleave, selectWindow } from "./rerank";
import { facetsOf, scoreProject } from "./scoring";
import type {
  CandidateSource,
  RepoSnapshot,
  ScoredCandidate,
  Signals,
} from "./types";
import {
  scoreSemantic,
  selectSemanticWindow,
  type InterestCluster,
} from "./vectors";

export interface QueuePlanCaps {
  topic?: number;
  fresh?: number;
  longTail?: number;
  exploreSeeds?: number;
  pool?: number;
  batch?: number;
}

export interface QueuePlanInput {
  /**
   * Candidate universe. Archived repositories are filtered here; already
   * touched/consumed/queued IDs must be excluded by the caller (they are
   * caller-specific: session exclusions, queue contents).
   */
  unseen: RepoSnapshot[];
  signals: Signals;
  followedTopics: Set<string>;
  weights?: RankingWeights;
  clusters?: InterestCluster[];
  /** Embedding vectors available for scoring/rerank, by repoId. */
  vectorsByRepo?: Map<number, number[]>;
  negativeVectors?: number[][];
  /** Candidates from vector retrieval (semantic + adjacent), with sources. */
  extraCandidates?: SourcedRepo[];
  caps?: QueuePlanCaps;
}

export interface PlannedItem {
  repoId: number;
  score: number;
  reasons: string[];
  sources: CandidateSource[];
}

export interface QueuePlanStats {
  unseenCount: number;
  candidateCount: number;
  candidateBySource: Record<string, number>;
  poolSize: number;
  semanticCoverage: number;
  exploreCount: number;
  usedSemanticRerank: boolean;
}

export interface QueuePlan {
  items: PlannedItem[];
  stats: QueuePlanStats;
}

function countSources(
  entries: { sources: CandidateSource[] }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    for (const source of entry.sources) {
      counts[source] = (counts[source] ?? 0) + 1;
    }
  }
  return counts;
}

export function planQueueBatch(input: QueuePlanInput): QueuePlan {
  const weights = input.weights ?? SEMANTIC_WEIGHTS;
  const clusters = input.clusters ?? [];
  const vectorsByRepo = input.vectorsByRepo ?? new Map<number, number[]>();
  const negatives = input.negativeVectors ?? [];
  const caps = input.caps ?? {};
  const batchSize = caps.batch ?? GEN_BATCH;

  const { signals, followedTopics } = input;
  // Defensive: archived repositories never queue, whoever the caller is.
  const unseen = input.unseen.filter((repo) => !repo.archived);

  // 1. Metadata generators (bounded subsets with provenance).
  const metadata = dedupeSourced([
    topicMatchedRepos(
      unseen,
      signals,
      followedTopics,
      caps.topic ?? GEN_TOPIC_CAP,
    ),
    freshRepos(unseen, signals.now, caps.fresh ?? GEN_FRESH_CAP),
    longTailRepos(unseen, caps.longTail ?? GEN_LONGTAIL_CAP),
  ]);
  // 2. Exploration seeds from the full unseen set (independent path).
  const seeds = selectExploration(
    unseen,
    signals,
    caps.exploreSeeds ?? GEN_EXPLORE_SEEDS,
  );
  const seedRepos = seeds.map((pick) => ({
    repo: pick.repo,
    sources: ["exploration"] as CandidateSource[],
  }));
  // 3. Union with vector-retrieval candidates; provenance merges on collision.
  const union = dedupeSourced([
    metadata,
    seedRepos,
    input.extraCandidates ?? [],
  ]);

  // 4. Score everything (semantic features where vectors exist).
  const semanticExtras = (repoId: number) => {
    const vector = vectorsByRepo.get(repoId);
    const semantic = vector
      ? scoreSemantic(vector, clusters, negatives)
      : undefined;
    return {
      best: semantic?.best,
      weighted: semantic?.weighted,
      negative: semantic?.negative,
      followedTopics,
    };
  };
  const scored: ScoredCandidate[] = union.map(({ repo, sources }) => {
    const { score, features, parts } = scoreProject(
      repo,
      signals,
      weights,
      semanticExtras(repo.repoId),
    );
    return {
      repo,
      score,
      explore: 0,
      facets: facetsOf(repo),
      sources: mergeSources(tagSources(repo, signals, followedTopics), sources),
      features,
      parts,
    };
  });

  // 5. Pool cut by score. Exploration seeds are protected: they bypass the
  // score cut (otherwise the pool would eat the exploration budget).
  const poolCap = Math.max(1, caps.pool ?? GEN_POOL);
  const seedIds = new Set(
    union
      .filter((entry) => entry.sources.includes("exploration"))
      .map((entry) => entry.repo.repoId),
  );
  const byId = new Map(scored.map((entry) => [entry.repo.repoId, entry]));
  const topScored = [...scored]
    .sort((a, b) => b.score - a.score || a.repo.repoId - b.repo.repoId)
    .slice(0, poolCap);
  const poolMap = new Map(topScored.map((entry) => [entry.repo.repoId, entry]));
  for (const seedId of seedIds) {
    const seed = byId.get(seedId);
    if (seed && !poolMap.has(seedId)) poolMap.set(seedId, seed);
  }
  const pool = [...poolMap.values()];
  const withVectors = pool.filter((entry) =>
    vectorsByRepo.has(entry.repo.repoId),
  );
  const semanticCoverage =
    pool.length > 0 ? withVectors.length / pool.length : 0;

  // 6. Split explorers; rerank the rest. Semantic MMR only when every pool
  // member has a vector — otherwise facet MMR (predictable degradation while
  // backfill is incomplete).
  const exploreIds = new Set(
    pool
      .filter((entry) => entry.sources.includes("exploration"))
      .map((entry) => entry.repo.repoId),
  );
  const rankedPool = pool.filter((entry) => !exploreIds.has(entry.repo.repoId));
  const useSemanticRerank =
    rankedPool.length > 0 &&
    rankedPool.every((entry) => vectorsByRepo.has(entry.repo.repoId));
  let ranked: ScoredCandidate[];
  if (useSemanticRerank) {
    const vectored = rankedPool.flatMap((entry) => {
      const vector = vectorsByRepo.get(entry.repo.repoId);
      return vector ? [{ item: entry, score: entry.score, vector }] : [];
    });
    ranked = selectSemanticWindow(vectored, Math.max(0, batchSize));
  } else {
    ranked = selectWindow(
      rankedPool.map((entry) => ({
        item: entry,
        score: entry.score,
        facets: entry.facets,
        owner: entry.repo.owner,
      })),
      Math.max(0, batchSize),
    );
  }
  // Explorers keep their diversified seed order, capped to a third of batch.
  const explorers = seeds
    .flatMap((pick) => {
      const entry = poolMap.get(pick.repo.repoId);
      return entry ? [entry] : [];
    })
    .slice(0, Math.max(1, Math.floor(batchSize / 3)));
  const window = interleave(explorers, ranked, batchSize);

  // 7. Explain. Order is the queue order; the persistence layer assigns
  // absolute ranks continuing from the current maximum.
  const items: PlannedItem[] = window.map((entry) => ({
    repoId: entry.repo.repoId,
    score: entry.score,
    reasons: explainCandidate({
      candidate: entry,
      signals,
      followedTopics,
    }),
    sources: entry.sources,
  }));

  return {
    items,
    stats: {
      unseenCount: unseen.length,
      candidateCount: union.length,
      candidateBySource: countSources(union),
      poolSize: pool.length,
      semanticCoverage,
      exploreCount: explorers.length,
      usedSemanticRerank: useSemanticRerank,
    },
  };
}

function mergeSources(
  tagged: CandidateSource[],
  extra: CandidateSource[],
): CandidateSource[] {
  const out = [...tagged];
  for (const source of extra) {
    if (!out.includes(source)) out.push(source);
  }
  return out;
}
