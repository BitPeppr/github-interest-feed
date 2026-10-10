/**
 * Candidate assembly: filter → tag provenance → score → pool → explore on an
 * independent path → rank → interleave → window.
 *
 * Dedupe happens once, after all generators contribute, and provenance is
 * unioned so diagnostics can see every path that surfaced a repository.
 */
import {
  CANDIDATE_POOL,
  EXPLORE_COOL_FLOOR,
  EXPLORE_COOL_IMPRESSIONS,
  EXPLORE_SLOTS,
  FEED_WINDOW,
  FRESH_WINDOW_DAYS,
  LONG_TAIL_STAR_THRESHOLD,
  type RankingWeights,
  DEFAULT_WEIGHTS,
} from "./constants";
import { selectExploration } from "./exploration";
import { interleave, selectWindow } from "./rerank";
import { facetsOf, scoreProject } from "./scoring";
import type {
  CandidateSource,
  RepoSnapshot,
  ScoredCandidate,
  Signals,
} from "./types";

export interface AssembleOptions {
  weights?: RankingWeights;
  poolSize?: number;
  exploreSlots?: number;
  windowSize?: number;
  limit?: number;
}

export interface AssembledFeed {
  window: ScoredCandidate[];
  /** Unseen candidates that lost the window (for `remaining` counts). */
  unseenCount: number;
}

/** Tag cheap provenance available without semantic retrieval. */
export function tagSources(
  repo: RepoSnapshot,
  signals: Signals,
): CandidateSource[] {
  const sources: CandidateSource[] = ["ranked"];
  if (
    repo.pushedAt !== undefined &&
    signals.now - repo.pushedAt <= FRESH_WINDOW_DAYS * 86_400_000
  ) {
    sources.push("fresh");
  }
  let affinity = false;
  for (const topic of repo.topics) {
    if ((signals.topicAffinity.get(topic) ?? 0) > 0) {
      affinity = true;
      break;
    }
  }
  if (
    !affinity &&
    repo.language &&
    (signals.languageAffinity.get(repo.language) ?? 0) > 0
  ) {
    affinity = true;
  }
  if (!affinity && (signals.ownerAffinity.get(repo.owner) ?? 0) > 0) {
    affinity = true;
  }
  if (affinity) sources.push("topic");
  if (repo.stars < LONG_TAIL_STAR_THRESHOLD) sources.push("long-tail");
  return sources;
}

/** Merge duplicate candidates, unioning provenance. */
export function dedupe(entries: ScoredCandidate[]): ScoredCandidate[] {
  const byId = new Map<number, ScoredCandidate>();
  for (const entry of entries) {
    const existing = byId.get(entry.repo.repoId);
    if (!existing) {
      byId.set(entry.repo.repoId, entry);
      continue;
    }
    const sources = [...existing.sources];
    for (const source of entry.sources) {
      if (!sources.includes(source)) sources.push(source);
    }
    // Keep the higher-scored representative; provenance is what merges.
    byId.set(
      entry.repo.repoId,
      entry.score > existing.score
        ? { ...entry, sources }
        : { ...existing, sources },
    );
  }
  return [...byId.values()];
}

export function assembleFeed(
  catalog: RepoSnapshot[],
  signals: Signals,
  touched: Set<number>,
  excluded: Set<number>,
  options: AssembleOptions = {},
): AssembledFeed {
  const weights: RankingWeights = options.weights ?? DEFAULT_WEIGHTS;
  const poolSize = options.poolSize ?? CANDIDATE_POOL;
  // `windowSize` is the explicit knob and `limit` the caller-facing alias.
  // Previously only `limit` was read, so passing `windowSize` silently fell
  // back to FEED_WINDOW.
  const windowSize = Math.max(
    1,
    Math.min(options.windowSize ?? options.limit ?? FEED_WINDOW, FEED_WINDOW),
  );

  const unseen = catalog.filter(
    (repo) =>
      !repo.archived && !touched.has(repo.repoId) && !excluded.has(repo.repoId),
  );

  const scored: ScoredCandidate[] = unseen.map((repo) => {
    const { score, features, parts } = scoreProject(repo, signals, weights);
    return {
      repo,
      score,
      explore: 0,
      facets: facetsOf(repo),
      sources: tagSources(repo, signals),
      features,
      parts,
    };
  });

  // Exploitation pool: the best-scoring candidates. Ties break by ascending
  // repoId — deterministic, and repository identity no longer perturbs scores.
  const pool = scored
    .sort((a, b) => b.score - a.score || a.repo.repoId - b.repo.repoId)
    .slice(0, poolSize);

  // Exploration runs on the FULL unseen set, not the scored pool, so unusual
  // repositories are reachable even with low predicted interest.
  //
  // The reserved slice cools as impressions accumulate: early on the feed is
  // mostly discovery, later it leans on what it has learned. An explicit
  // `exploreSlots` is a caller's decision and is honoured as given; cooling
  // only governs the default.
  const exploreCool = Math.max(
    EXPLORE_COOL_FLOOR,
    1 - signals.totalImpressions / EXPLORE_COOL_IMPRESSIONS,
  );
  const exploreSlots =
    options.exploreSlots ??
    Math.min(
      EXPLORE_SLOTS,
      Math.max(1, Math.floor((windowSize / 3) * exploreCool)),
    );
  const scoredById = new Map(scored.map((entry) => [entry.repo.repoId, entry]));
  const explorers = selectExploration(unseen, signals, exploreSlots);
  const exploreIds = new Set(explorers.map((entry) => entry.repo.repoId));
  const ranked = selectWindow(
    pool
      .filter((entry) => !exploreIds.has(entry.repo.repoId))
      .map((entry) => ({
        item: entry,
        score: entry.score,
        facets: entry.facets,
        owner: entry.repo.owner,
        language: entry.repo.language,
      })),
    windowSize - explorers.length,
  );
  // selectExploration already diversified these; keep its order.
  const explorerItems = explorers.map((pick) => {
    const match = scoredById.get(pick.repo.repoId);
    const base = match ?? {
      repo: pick.repo,
      score: Number.NEGATIVE_INFINITY,
      explore: pick.explore,
      facets: pick.facets,
      sources: [] as CandidateSource[],
      features: scoreProject(pick.repo, signals, weights).features,
      parts: [],
    };
    const sources = [...base.sources];
    if (!sources.includes("exploration")) sources.push("exploration");
    return { ...base, explore: pick.explore, sources };
  });
  const window = interleave<ScoredCandidate>(explorerItems, ranked, windowSize);

  return { window, unseenCount: unseen.length };
}
