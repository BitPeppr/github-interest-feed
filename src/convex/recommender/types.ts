/**
 * Shared recommender vocabulary.
 *
 * These types are intentionally free of Convex imports so ranking logic can be
 * unit tested in Node and reused by the offline evaluation harness. Convex
 * documents are converted to {@link RepoSnapshot} at the module boundary
 * (see `feed.ts`).
 */

/** Where a candidate came from. Provenance survives dedupe and ranking. */
export type CandidateSource =
  | "ranked"
  | "topic"
  | "fresh"
  | "long-tail"
  | "semantic"
  | "adjacent"
  | "exploration";

/**
 * The minimal repository shape ranking needs. Deliberately mirrors the fields
 * of the `repos` table without depending on its generated document type.
 */
export interface RepoSnapshot {
  repoId: number;
  fullName: string;
  owner: string;
  name: string;
  description?: string;
  stars: number;
  forks: number;
  openIssues: number;
  language?: string;
  topics: string[];
  pushedAt?: number;
  archived: boolean;
  discoveredVia: string[];
  /** Stars gained over roughly the last week. Undefined when not measured. */
  starGrowth7d?: number;
  /** Growth speeding up (positive) or fading (negative). */
  starAccel?: number;
}

/** One user touchpoint paired with the repository it refers to. */
export interface RatedRepo {
  repo: RepoSnapshot;
  /** 1-5 interest rating, if the user rated it. */
  value?: number;
  saved?: boolean;
  hidden?: boolean;
}

/**
 * Per-candidate ranking features. Features are pure measurements; weights live
 * in `constants.ts`. Semantic fields exist now so later PRs enable them by
 * changing weights, not shapes.
 */
export interface RankingFeatures {
  /** Best cosine similarity to any positive interest cluster. */
  semanticBest: number;
  /** Weight-averaged similarity across positive clusters. */
  semanticWeighted: number;
  /** Similarity to negative preferences (subtracted). */
  negativeSimilarity: number;
  /** Capped count of the best-matching liked topic. */
  topicAffinity: number;
  /** Capped count for the repository language. */
  languageAffinity: number;
  /** Capped count for the repository owner. */
  ownerAffinity: number;
  /** Strongest dislike attached to any of the repo topics (<= 0). */
  topicDislike: number;
  /** Dislike attached to the language (<= 0). */
  languageDislike: number;
  /** Dislike attached to the owner (<= 0). */
  ownerDislike: number;
  /** Recency in [0, 1], half-life decayed. */
  freshness: number;
  /** Bounded log-popularity. */
  quality: number;
  /** Bounded log of weekly star growth. "Before it was big" beats "already famous". */
  velocity: number;
  /** Bounded log of star-growth acceleration. */
  acceleration: number;
  /** Bandit optimism: value of showing something under-exposed. */
  exploration: number;
  /** First-sighting bonus steps (0, 1 or 2 facets unseen). */
  firstSighting: number;
  /** 1 when the repo sits below the long-tail star threshold. */
  longTail: number;
}

/** One weighted contribution, for diagnostics and explanations. */
export interface ScorePart {
  key: keyof RankingFeatures;
  feature: number;
  weight: number;
  contribution: number;
}

/** A scored candidate with its provenance and debug trace. */
export interface ScoredCandidate {
  repo: RepoSnapshot;
  score: number;
  explore: number;
  facets: Set<string>;
  sources: CandidateSource[];
  features: RankingFeatures;
  parts: ScorePart[];
}

/** Aggregated per-user signals derived from rating history. */
export interface Signals {
  now: number;
  totalImpressions: number;
  topicAffinity: Map<string, number>;
  languageAffinity: Map<string, number>;
  ownerAffinity: Map<string, number>;
  topicDislike: Map<string, number>;
  languageDislike: Map<string, number>;
  ownerDislike: Map<string, number>;
  topicSeen: Map<string, number>;
  languageSeen: Map<string, number>;
  ownerSeen: Map<string, number>;
}

/** Empty feature vector (e.g. cold start contributes nothing). */
export function zeroFeatures(): RankingFeatures {
  return {
    semanticBest: 0,
    semanticWeighted: 0,
    negativeSimilarity: 0,
    topicAffinity: 0,
    languageAffinity: 0,
    ownerAffinity: 0,
    topicDislike: 0,
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
