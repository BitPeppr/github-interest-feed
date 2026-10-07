/**
 * Offline recommendation evaluation.
 *
 * Two uses, same pure functions:
 * 1. Regression gates (CI): a deterministic synthetic universe proves the
 *    machinery works — held-out positives rank above distractors, slates
 *    stay diverse, metrics handle edge cases without NaNs.
 * 2. Real-data replay: export interactionEvents + repo snapshots as JSON
 *    (see `parseInteractionJson`), run the same replay per user, compare
 *    weight candidates before changing production weights.
 *
 * What this does NOT do: bless production weight changes on synthetic data
 * alone. The synthetic universe validates mechanics; real tuning needs real
 * behaviour. The tuning procedure is documented in docs/recommender.md.
 */
import { SEMANTIC_WEIGHTS } from "./constants";
import { tagSources } from "./candidates";
import { buildSignals } from "./signals";
import { scoreProject } from "./scoring";
import type { RatedRepo, RepoSnapshot } from "./types";
import {
  buildInterestClusters,
  cosine,
  evidenceWeight,
  scoreSemantic,
} from "./vectors";

export interface EvalEvent {
  repo: RepoSnapshot;
  vector?: number[];
  value?: number;
  saved?: boolean;
  hidden?: boolean;
  githubOpens?: number;
  readmeOpens?: number;
  /** Milliseconds since epoch; replay splits on time. */
  at: number;
}

export interface EvalSplit {
  train: EvalEvent[];
  /** Later positive interactions the model must rank highly. */
  heldout: EvalEvent[];
}

function isPositive(event: EvalEvent): boolean {
  return (
    (event.value !== undefined && event.value >= 4) || event.saved === true
  );
}

/**
 * Time split: the earliest (1 - holdoutFraction) of events train the model,
 * later POSITIVES become the retrieval target. Later negatives stay out of
 * both sets (they would leak future taste into training if included, and
 * they are not retrieval targets either).
 */
export function timeSplit(
  events: EvalEvent[],
  holdoutFraction = 0.3,
): EvalSplit {
  const ordered = [...events].sort(
    (a, b) => a.at - b.at || a.repo.repoId - b.repo.repoId,
  );
  const cutoff = Math.floor(ordered.length * (1 - holdoutFraction));
  const train = ordered.slice(0, cutoff);
  const heldout = ordered.slice(cutoff).filter(isPositive);
  return { train, heldout };
}

export interface RankedRepo {
  repoId: number;
  score: number;
}

/**
 * Rank held-out positives against distractors using the production scoring
 * path (signals + semantic features + SEMANTIC weights). Distractors must be
 * repos the train set never touched.
 */
export function rankForEval(
  train: EvalEvent[],
  heldout: EvalEvent[],
  distractors: EvalEvent[],
  weights: Parameters<typeof scoreProject>[2] = SEMANTIC_WEIGHTS,
): RankedRepo[] {
  const now = Math.max(...train.map((event) => event.at), 0);
  const rated: RatedRepo[] = train.map((event) => ({
    repo: event.repo,
    value: event.value,
    saved: event.saved,
    hidden: event.hidden,
    githubOpens: event.githubOpens,
    readmeOpens: event.readmeOpens,
  }));
  const signals = buildSignals(now, rated);
  const clusters = buildInterestClusters(
    train.flatMap((event) => {
      const weight = evidenceWeight({
        value: event.value,
        saved: event.saved,
        githubOpens: event.githubOpens,
      });
      return event.vector && weight > 0
        ? [{ repoId: event.repo.repoId, vector: event.vector, weight }]
        : [];
    }),
    now,
  );
  const negatives = train.flatMap((event) =>
    event.vector &&
    (event.hidden === true ||
      (typeof event.value === "number" && event.value <= 2))
      ? [event.vector]
      : [],
  );
  const candidates = [...heldout, ...distractors];
  return candidates
    .map((event) => {
      const semantic = event.vector
        ? scoreSemantic(event.vector, clusters, negatives)
        : undefined;
      const { score } = scoreProject(event.repo, signals, weights, {
        best: semantic?.best,
        weighted: semantic?.weighted,
        negative: semantic?.negative,
      });
      return { repoId: event.repo.repoId, score };
    })
    .sort((a, b) => b.score - a.score || a.repoId - b.repoId);
}

export function precisionAtK(
  ranked: RankedRepo[] | number[],
  relevant: Set<number>,
  k: number,
): number {
  if (relevant.size === 0 || k <= 0) return 0;
  const ids = ranked.map((entry) =>
    typeof entry === "number" ? entry : entry.repoId,
  );
  const hits = ids.slice(0, k).filter((id) => relevant.has(id)).length;
  return hits / Math.min(k, ids.length || 1);
}

export function recallAtK(
  ranked: RankedRepo[] | number[],
  relevant: Set<number>,
  k: number,
): number {
  if (relevant.size === 0 || k <= 0) return 0;
  const ids = ranked.map((entry) =>
    typeof entry === "number" ? entry : entry.repoId,
  );
  const hits = ids.slice(0, k).filter((id) => relevant.has(id)).length;
  return hits / relevant.size;
}

export function ndcgAtK(
  ranked: RankedRepo[] | number[],
  relevant: Set<number>,
  k: number,
): number {
  if (relevant.size === 0 || k <= 0) return 0;
  const ids = ranked.map((entry) =>
    typeof entry === "number" ? entry : entry.repoId,
  );
  const top = ids.slice(0, k);
  let dcg = 0;
  top.forEach((id, index) => {
    if (relevant.has(id)) dcg += 1 / Math.log2(index + 2);
  });
  const ideal = Math.min(top.length, relevant.size);
  let idcg = 0;
  for (let rank = 0; rank < ideal; rank += 1) idcg += 1 / Math.log2(rank + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

export interface SlateItem {
  repo: RepoSnapshot;
  sources: string[];
}

export interface SlateStats {
  size: number;
  uniqueOwners: number;
  uniqueLanguages: number;
  uniqueTopics: number;
  exploreShare: number;
  longTailShare: number;
  semanticShare: number;
  /** Mean pairwise cosine over the slate, null without vectors. */
  avgPairwiseCosine: number | null;
}

export function slateStats(
  items: SlateItem[],
  vectorsByRepo: Map<number, number[]> = new Map(),
): SlateStats {
  const owners = new Set(items.map((item) => item.repo.owner));
  const languages = new Set(
    items.map((item) => item.repo.language ?? "").filter(Boolean),
  );
  const topics = new Set(items.flatMap((item) => item.repo.topics));
  const share = (source: string) =>
    items.length === 0
      ? 0
      : items.filter((item) => item.sources.includes(source)).length /
        items.length;
  const vectors = items.flatMap((item) => {
    const vector = vectorsByRepo.get(item.repo.repoId);
    return vector ? [vector] : [];
  });
  let avgPairwiseCosine: number | null = null;
  if (vectors.length >= 2) {
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i < vectors.length; i += 1) {
      for (let j = i + 1; j < vectors.length; j += 1) {
        sum += cosine(vectors[i], vectors[j]);
        pairs += 1;
      }
    }
    avgPairwiseCosine = pairs > 0 ? sum / pairs : null;
  }
  return {
    size: items.length,
    uniqueOwners: owners.size,
    uniqueLanguages: languages.size,
    uniqueTopics: topics.size,
    exploreShare: share("exploration"),
    longTailShare: share("long-tail"),
    semanticShare: share("semantic"),
    avgPairwiseCosine,
  };
}

export interface ReplayResult {
  heldoutCount: number;
  rankedCount: number;
  precisionAt5: number;
  precisionAt10: number;
  recallAt10: number;
  ndcgAt10: number;
  slate: SlateStats;
}

/** Full replay: split → rank → metrics + slate diagnostics. */
export function replay(
  events: EvalEvent[],
  distractors: EvalEvent[],
  weights?: Parameters<typeof scoreProject>[2],
): ReplayResult {
  const { train, heldout } = timeSplit(events);
  const trainSignals = buildSignals(
    Math.max(...train.map((event) => event.at), 0),
    train.map((event) => ({
      repo: event.repo,
      value: event.value,
      saved: event.saved,
      hidden: event.hidden,
      githubOpens: event.githubOpens,
      readmeOpens: event.readmeOpens,
    })),
  );
  const ranked = rankForEval(train, heldout, distractors, weights);
  const relevant = new Set(heldout.map((event) => event.repo.repoId));
  const vectors = new Map<number, number[]>();
  const byId = new Map<number, EvalEvent>();
  for (const event of [...heldout, ...distractors]) {
    byId.set(event.repo.repoId, event);
    if (event.vector) vectors.set(event.repo.repoId, event.vector);
  }
  const slateItems = ranked.slice(0, 10).flatMap((entry) => {
    const found = byId.get(entry.repoId);
    return found
      ? [{ repo: found.repo, sources: tagSources(found.repo, trainSignals) }]
      : [];
  });
  return {
    heldoutCount: heldout.length,
    rankedCount: ranked.length,
    precisionAt5: precisionAtK(ranked, relevant, 5),
    precisionAt10: precisionAtK(ranked, relevant, 10),
    recallAt10: recallAtK(ranked, relevant, 10),
    ndcgAt10: ndcgAtK(ranked, relevant, 10),
    slate: slateStats(slateItems, vectors),
  };
}

/**
 * Parse an exported interaction history (Convex dashboard JSON export of
 * interactionEvents joined with repos) into eval events. Strict: unknown
 * shapes throw rather than silently evaluating garbage.
 */
export function parseInteractionJson(input: unknown): EvalEvent[] {
  if (!Array.isArray(input)) throw new Error("Expected a JSON array.");
  return input.map((row, index) => {
    if (typeof row !== "object" || row === null) {
      throw new Error(`Row ${index} is not an object.`);
    }
    const record = row as Record<string, unknown>;
    const repo = record["repo"] as Record<string, unknown> | undefined;
    if (!repo || typeof repo["repoId"] !== "number") {
      throw new Error(`Row ${index} has no repo.repoId.`);
    }
    const snapshot = repo as unknown as RepoSnapshot;
    const at = record["at"];
    if (typeof at !== "number") throw new Error(`Row ${index} has no at.`);
    const event: EvalEvent = { repo: snapshot, at };
    if (typeof record["value"] === "number") event.value = record["value"];
    if (typeof record["saved"] === "boolean") event.saved = record["saved"];
    if (typeof record["hidden"] === "boolean") event.hidden = record["hidden"];
    if (Array.isArray(record["vector"])) {
      const vector = (record["vector"] as unknown[]).filter(
        (value): value is number => typeof value === "number",
      );
      if (vector.length > 0) event.vector = vector;
    }
    return event;
  });
}
