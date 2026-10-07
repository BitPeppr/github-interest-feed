/**
 * Central ranking configuration. Every tunable coefficient lives here — no
 * magic numbers in scoring, exploration or reranking code.
 *
 * Tuning guidance: change one weight at a time and re-run the offline
 * evaluation harness (`npm run eval`) before committing a new value.
 */
import type { RankingFeatures } from "./types";

/** Multiplicative weights applied to each ranking feature. */
export interface RankingWeights {
  semanticBest: number;
  semanticWeighted: number;
  /**
   * Similarity to disliked regions. Carries a NEGATIVE weight: the feature is
   * a non-negative magnitude and the weight subtracts it from the score.
   */
  negativeSimilarity: number;
  topicAffinity: number;
  languageAffinity: number;
  ownerAffinity: number;
  topicDislike: number;
  languageDislike: number;
  ownerDislike: number;
  freshness: number;
  quality: number;
  velocity: number;
  acceleration: number;
  exploration: number;
  firstSighting: number;
  longTail: number;
}

/**
 * Default weights. They reproduce the ranking behaviour of the pre-refactor
 * `feed.ts` as tuned upstream, with two differences.
 *
 * Randomness is gone: the old `((repoId % 997) / 997) * 0.9` jitter contributed
 * up to +0.9 to a score — more than any single affinity signal — so repository
 * IDs materially altered ordering. That term is gone; ties break deterministically
 * by ascending repoId. Semantic and long-tail weights are 0 until the embedding
 * pipeline (PR3) and queue serving (PR4) land.
 *
 * Popularity is a tiebreaker, not the signal. At the old 0.35·log10(stars) a
 * 100k-star repository outranked every smaller one, so whole domains — keyboards,
 * TUIs, simulations, art, music — could never reach the window once catalogued.
 * Star *velocity* and *acceleration* now outrank star size instead: "before it
 * was big" beats "already famous", which is the whole point of a discovery feed.
 */
export const DEFAULT_WEIGHTS: RankingWeights = {
  semanticBest: 0,
  semanticWeighted: 0,
  negativeSimilarity: 0,
  topicAffinity: 0.4,
  languageAffinity: 0.6,
  ownerAffinity: 0.6,
  topicDislike: 1,
  languageDislike: 1,
  ownerDislike: 1,
  freshness: 1,
  quality: 0.22,
  velocity: 0.55,
  acceleration: 0.3,
  exploration: 1.1,
  firstSighting: 0.45,
  longTail: 0,
};

/** Feature-level caps. Counts stop mattering after a few repetitions. */
export const AFFINITY_COUNT_CAP = 3;

/**
 * Contribution ceilings for the three size/growth features. A cap applied after
 * weighting cannot be expressed as a plain feature measurement, so the ceiling
 * is stated here and the feature cap is derived as `ceiling / weight`. Keeping
 * the derivation explicit stops the two from drifting apart during tuning.
 */
export const QUALITY_MAX_CONTRIBUTION = 0.9;
export const VELOCITY_MAX_CONTRIBUTION = 1.7;
export const ACCELERATION_MAX_CONTRIBUTION = 0.6;

/** Log-popularity feature is capped so mega-stars cannot dominate. */
export const QUALITY_LOG_CAP =
  QUALITY_MAX_CONTRIBUTION / DEFAULT_WEIGHTS.quality;
/** Log star-growth feature, capped at the velocity contribution ceiling. */
export const VELOCITY_LOG_CAP =
  VELOCITY_MAX_CONTRIBUTION / DEFAULT_WEIGHTS.velocity;
/** Log acceleration feature, capped at the acceleration ceiling. */
export const ACCELERATION_LOG_CAP =
  ACCELERATION_MAX_CONTRIBUTION / DEFAULT_WEIGHTS.acceleration;
/** Freshness half-life, in days (Reddit/HN-style decay). */
export const FRESH_HALF_LIFE_DAYS = 45;
/** Stars below this count as long-tail once the long-tail weight is on. */
export const LONG_TAIL_STAR_THRESHOLD = 500;
/** pushedAt within this window tags a candidate `fresh`. */
export const FRESH_WINDOW_DAYS = 30;

/** Exploration split inside the topic/optimism feature (kept from v1). */
export const TOPIC_EXPLORE_SHARE = 0.4;
export const LANGUAGE_EXPLORE_SHARE = 0.8;
export const OWNER_EXPLORE_SHARE = 0.5;

/** A skip says more than a low score does. */
export const HIDE_DISLIKE_WEIGHT = 1;
export const LOW_RATING_DISLIKE_WEIGHT = 0.6;
/** Base dislike magnitudes (multiplied by the weight above). */
export const DISLIKE_TOPIC = -0.8;
export const DISLIKE_LANGUAGE = -1;
export const DISLIKE_OWNER = -1.6;

/** Ratings >= this value build positive affinity. */
export const POSITIVE_RATING_THRESHOLD = 4;
/** Ratings <= this value build negative affinity. */
export const NEGATIVE_RATING_THRESHOLD = 2;

/** Scored candidates the selector chooses from, after the catalog scan. */
export const CANDIDATE_POOL = 400;
/** Slots in every window reserved for exploration instead of score. */
export const EXPLORE_SLOTS = 6;
/**
 * The reserved slice cools as impressions accumulate: early on the feed is
 * mostly discovery, later it leans on what it has learned. Exploration never
 * falls below {@link EXPLORE_COOL_FLOOR} of its nominal share.
 */
export const EXPLORE_COOL_IMPRESSIONS = 300;
export const EXPLORE_COOL_FLOOR = 0.5;
/** Feed window size served per request. */
export const FEED_WINDOW = 24;

/** Similarity cost in the reranker (cheap MMR/DPP analogue). */
export const SIMILARITY_PENALTY = 0.55;
/** Per-owner decay inside one window (repeated-author decay). */
export const REPEAT_DECAY = 0.55;
export const REPEAT_FLOOR = 0.18;
/**
 * Milder per-language decay. Languages do not show up in Jaccard similarity
 * strongly enough to stop one ecosystem flooding a window, so a couple of a
 * language are free and each further one costs a little.
 */
export const LANGUAGE_REPEAT_FREE = 2;
export const LANGUAGE_REPEAT_DECAY = 0.8;
export const LANGUAGE_REPEAT_FLOOR = 0.5;
/** Exploration shortlist multiplier: shortlist N*4, select N. */
export const EXPLORE_SHORTLIST_FACTOR = 4;

/** All feature keys, so diagnostics iterate weights without drift. */
export const FEATURE_KEYS: (keyof RankingFeatures)[] = [
  "semanticBest",
  "semanticWeighted",
  "negativeSimilarity",
  "topicAffinity",
  "languageAffinity",
  "ownerAffinity",
  "topicDislike",
  "languageDislike",
  "ownerDislike",
  "freshness",
  "quality",
  "velocity",
  "acceleration",
  "exploration",
  "firstSighting",
  "longTail",
];
