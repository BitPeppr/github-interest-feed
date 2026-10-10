/**
 * Feature extraction and weighted scoring. `extractFeatures` measures,
 * `scoreFeatures` weighs — tuning never touches measurement code.
 *
 * Archived repositories score -Infinity-equivalent so callers can filter them
 * without a special case at every call site.
 */
import {
  ACCELERATION_LOG_CAP,
  AFFINITY_COUNT_CAP,
  DEFAULT_WEIGHTS,
  FRESH_HALF_LIFE_DAYS,
  LANGUAGE_EXPLORE_SHARE,
  LONG_TAIL_STAR_THRESHOLD,
  OWNER_EXPLORE_SHARE,
  QUALITY_LOG_CAP,
  TOPIC_EXPLORE_SHARE,
  VELOCITY_LOG_CAP,
  type RankingWeights,
} from "./constants";
import type {
  RankingFeatures,
  RepoSnapshot,
  ScorePart,
  Signals,
} from "./types";
import { FEATURE_KEYS } from "./constants";

/** 1 while a project is fresh, 0.5 at the half-life, →0 as it ages. */
export function freshness(pushedAt: number | undefined, now: number): number {
  if (!pushedAt) return 0;
  const ageDays = Math.max(0, (now - pushedAt) / 86_400_000);
  return 0.5 ** (ageDays / FRESH_HALF_LIFE_DAYS);
}

/** How much a facet count should push the feed; capped so it cannot stack. */
export function affinityWeight(count: number): number {
  return Math.min(count, AFFINITY_COUNT_CAP);
}

/**
 * Optimism under uncertainty (the bandit rule): a facet the viewer has barely
 * been shown can still teach the feed something, so it is worth surfacing.
 */
export function optimism(impressions: number, total: number): number {
  return Math.sqrt(Math.log(total + 2) / (1 + impressions));
}

/** Everything a similarity check cares about: topics, language and owner. */
export function facetsOf(repo: RepoSnapshot): Set<string> {
  const facets = new Set<string>();
  for (const topic of repo.topics) facets.add(`t:${topic}`);
  if (repo.language) facets.add(`l:${repo.language}`);
  facets.add(`o:${repo.owner}`);
  return facets;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Log of a star-growth measure, capped so a single breakout repository cannot
 * dominate the window. Growth is one-sided: fading velocity is not evidence of
 * interest, so a non-positive measure contributes nothing.
 */
export function starVelocity(measure: number | undefined, cap: number): number {
  if (!measure || measure <= 0) return 0;
  return Math.min(Math.log10(1 + measure), cap);
}

/** How much of a project's facets the viewer has never been shown at all. */
export function unexploredness(repo: RepoSnapshot, signals: Signals): number {
  let novelty = 0;
  if (repo.language && (signals.languageSeen.get(repo.language) ?? 0) === 0) {
    novelty += 1;
  }
  if ((signals.ownerSeen.get(repo.owner) ?? 0) === 0) novelty += 1;
  if (repo.topics.length > 0) {
    let sum = 0;
    for (const topic of repo.topics) {
      sum += optimism(
        signals.topicSeen.get(topic) ?? 0,
        signals.totalImpressions,
      );
    }
    novelty += sum / repo.topics.length;
  }
  return novelty;
}

/**
 * Measure every ranking feature for a repository. Semantic features default
 * to 0 and are filled by the semantic pipeline (PR3).
 */
export function extractFeatures(
  repo: RepoSnapshot,
  signals: Signals,
  semantic?: {
    best?: number;
    weighted?: number;
    negative?: number;
  },
): RankingFeatures {
  if (repo.archived) {
    return {
      semanticBest: 0,
      semanticWeighted: 0,
      negativeSimilarity: 0,
      topicAffinity: 0,
      languageAffinity: 0,
      ownerAffinity: 0,
      topicDislike: Number.NEGATIVE_INFINITY,
      languageDislike: 0,
      ownerDislike: 0,
      freshness: 0,
      quality: 0,
      velocity: 0,
      acceleration: 0,
      exploration: 0,
      firstSighting: 0,
      longTail: 0,
    };
  }

  // A project is as interesting as its best topic, not the sum of all twelve:
  // otherwise a repo tagged with everything outranks one tagged honestly.
  let topicAffinityMax = 0;
  let topicDislikeMax = 0;
  let topicExplore = 0;
  for (const topic of repo.topics) {
    topicAffinityMax = Math.max(
      topicAffinityMax,
      signals.topicAffinity.get(topic) ?? 0,
    );
    topicDislikeMax = Math.min(
      topicDislikeMax,
      signals.topicDislike.get(topic) ?? 0,
    );
    topicExplore += optimism(
      signals.topicSeen.get(topic) ?? 0,
      signals.totalImpressions,
    );
  }

  let languageAffinity = 0;
  let languageDislike = 0;
  let languageExplore = 0;
  let languageNew = 0;
  if (repo.language) {
    const seen = signals.languageSeen.get(repo.language) ?? 0;
    languageAffinity = signals.languageAffinity.get(repo.language) ?? 0;
    languageDislike = signals.languageDislike.get(repo.language) ?? 0;
    languageExplore = optimism(seen, signals.totalImpressions);
    if (seen === 0) languageNew = 1;
  }

  const ownerSeen = signals.ownerSeen.get(repo.owner) ?? 0;

  const exploration =
    (repo.topics.length > 0
      ? (topicExplore / repo.topics.length) * TOPIC_EXPLORE_SHARE
      : 0) +
    languageExplore * LANGUAGE_EXPLORE_SHARE +
    optimism(ownerSeen, signals.totalImpressions) * OWNER_EXPLORE_SHARE;

  return {
    semanticBest: semantic?.best ?? 0,
    semanticWeighted: semantic?.weighted ?? 0,
    negativeSimilarity: semantic?.negative ?? 0,
    topicAffinity: affinityWeight(topicAffinityMax),
    languageAffinity: affinityWeight(languageAffinity),
    ownerAffinity: affinityWeight(signals.ownerAffinity.get(repo.owner) ?? 0),
    topicDislike: topicDislikeMax,
    languageDislike,
    ownerDislike: signals.ownerDislike.get(repo.owner) ?? 0,
    freshness: freshness(repo.pushedAt, signals.now),
    quality: Math.min(Math.log10(repo.stars + 1), QUALITY_LOG_CAP),
    velocity: starVelocity(repo.starGrowth7d, VELOCITY_LOG_CAP),
    acceleration: starVelocity(repo.starAccel, ACCELERATION_LOG_CAP),
    exploration,
    firstSighting: languageNew + (ownerSeen === 0 ? 1 : 0),
    longTail: repo.stars < LONG_TAIL_STAR_THRESHOLD ? 1 : 0,
  };
}

/** Weighted sum with a per-feature contribution trace. */
export function scoreFeatures(
  features: RankingFeatures,
  weights: RankingWeights = DEFAULT_WEIGHTS,
): { score: number; parts: ScorePart[] } {
  const parts: ScorePart[] = FEATURE_KEYS.map((key) => {
    const contribution = features[key] * weights[key];
    return { key, feature: features[key], weight: weights[key], contribution };
  });
  const score = parts.reduce((sum, part) => sum + part.contribution, 0);
  return { score, parts };
}

/**
 * Convenience wrapper: extract then score. Archived repos return -Infinity so
 * they sort below every real candidate.
 */
export function scoreProject(
  repo: RepoSnapshot,
  signals: Signals,
  weights: RankingWeights = DEFAULT_WEIGHTS,
  semantic?: { best?: number; weighted?: number; negative?: number },
): { score: number; features: RankingFeatures; parts: ScorePart[] } {
  if (repo.archived) {
    const features = extractFeatures(repo, signals, semantic);
    return { score: Number.NEGATIVE_INFINITY, features, parts: [] };
  }
  const features = extractFeatures(repo, signals, semantic);
  const { score, parts } = scoreFeatures(features, weights);
  return { score, features, parts };
}
