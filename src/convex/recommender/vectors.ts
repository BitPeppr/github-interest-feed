/**
 * Vector math and multi-interest user modelling. Pure, dependency-free and
 * Convex-safe. All functions validate dimensions and throw on mismatch
 * rather than silently comparing incompatible spaces.
 */
import type { RepoSnapshot } from "./types";

export function dot(a: number[], b: number[]): number {
  assertSameLength(a, b);
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) sum += a[index] * b[index];
  return sum;
}

export function norm(vector: number[]): number {
  return Math.sqrt(dot(vector, vector));
}

/** Cosine similarity in [-1, 1]; zero vectors score 0 (no information). */
export function cosine(a: number[], b: number[]): number {
  assertSameLength(a, b);
  const denominator = norm(a) * norm(b);
  if (denominator === 0) return 0;
  return dot(a, b) / denominator;
}

export function normalize(vector: number[]): number[] {
  const length = norm(vector);
  if (length === 0) return [...vector];
  return vector.map((value) => value / length);
}

function assertSameLength(a: number[], b: number[]): void {
  if (a.length !== b.length) {
    throw new Error(
      `Embedding dimension mismatch: ${a.length} vs ${b.length}. ` +
        `Vectors from different models must never be compared.`,
    );
  }
}

/** Weight-averaged centroid of member vectors, normalized. */
export function centroid(
  members: { vector: number[]; weight: number }[],
): number[] {
  if (members.length === 0) throw new Error("Cannot centroid zero vectors.");
  const dimensions = members[0].vector.length;
  const acc = new Array<number>(dimensions).fill(0);
  let total = 0;
  for (const member of members) {
    if (member.vector.length !== dimensions) {
      throw new Error(
        `Embedding dimension mismatch: ${member.vector.length} vs ${dimensions}.`,
      );
    }
    total += member.weight;
    for (let index = 0; index < dimensions; index += 1) {
      acc[index] += member.vector[index] * member.weight;
    }
  }
  if (total === 0) return acc;
  return normalize(acc.map((value) => value / total));
}

export interface InterestCluster {
  id: string;
  centroid: number[];
  weight: number;
  repoIds: number[];
  /** Human label derived from member topics/language (may be undefined). */
  label?: string;
  updatedAt: number;
}

export interface ClusterInput {
  repoId: number;
  vector: number[];
  /** Behavioural evidence strength (5-star+save outweighs a bare view). */
  weight: number;
}

export interface ClusterOptions {
  maxClusters?: number;
  /** Join the best cluster at/above this cosine; else open a new one. */
  joinThreshold?: number;
  /** Below this, a repo joins the nearest cluster even when full. */
  orphanThreshold?: number;
}

/**
 * Greedy multi-interest clustering. One averaged user vector would blur Rust
 * CLIs and physics simulations into a meaningless middle; this keeps up to
 * `maxClusters` separate centroids so each interest retrieves on its own.
 * Deterministic: weights sort descending, repoId breaks ties.
 */
export function buildInterestClusters(
  items: ClusterInput[],
  now: number,
  options: ClusterOptions = {},
): InterestCluster[] {
  const maxClusters = options.maxClusters ?? 5;
  const joinThreshold = options.joinThreshold ?? 0.55;
  const orphanThreshold = options.orphanThreshold ?? 0.3;
  if (items.length === 0 || maxClusters <= 0) return [];

  const ordered = [...items].sort(
    (a, b) => b.weight - a.weight || a.repoId - b.repoId,
  );
  const clusters: {
    members: { vector: number[]; weight: number }[];
    repoIds: number[];
  }[] = [];

  for (const item of ordered) {
    const normalized = normalize(item.vector);
    let best = -1;
    let bestSim = -Infinity;
    for (let index = 0; index < clusters.length; index += 1) {
      const sim = cosine(normalized, centroid(clusters[index].members));
      if (sim > bestSim) {
        bestSim = sim;
        best = index;
      }
    }
    if (best >= 0 && bestSim >= joinThreshold) {
      clusters[best].members.push({ vector: normalized, weight: item.weight });
      clusters[best].repoIds.push(item.repoId);
    } else if (clusters.length < maxClusters) {
      clusters.push({
        members: [{ vector: normalized, weight: item.weight }],
        repoIds: [item.repoId],
      });
    } else if (best >= 0 && bestSim >= orphanThreshold) {
      clusters[best].members.push({ vector: normalized, weight: item.weight });
      clusters[best].repoIds.push(item.repoId);
    }
    // Else: evidence too far from every interest to matter; drop it rather
    // than diluting a real cluster.
  }

  return clusters
    .map((cluster, index) => {
      const weight = cluster.members.reduce(
        (sum, member) => sum + member.weight,
        0,
      );
      return {
        id: `c${index}`,
        centroid: centroid(cluster.members),
        weight,
        repoIds: [...cluster.repoIds].sort((a, b) => a - b),
        updatedAt: now,
      };
    })
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
}

/**
 * Label clusters from member metadata — the most common topic wins, falling
 * back to language. Labels emerge from evidence; no hardcoded taxonomy.
 */
export function labelClusters(
  clusters: InterestCluster[],
  reposById: Map<number, RepoSnapshot>,
): InterestCluster[] {
  return clusters.map((cluster) => {
    const topicCounts = new Map<string, number>();
    const languageCounts = new Map<string, number>();
    for (const repoId of cluster.repoIds) {
      const repo = reposById.get(repoId);
      if (!repo) continue;
      for (const topic of repo.topics) {
        topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
      }
      if (repo.language) {
        languageCounts.set(
          repo.language,
          (languageCounts.get(repo.language) ?? 0) + 1,
        );
      }
    }
    const top = (counts: Map<string, number>) =>
      [...counts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0]?.[0];
    return { ...cluster, label: top(topicCounts) ?? top(languageCounts) };
  });
}

export interface ScoredVector {
  repoId: number;
  vector: number[];
  /** Precomputed exploitation score (quality, freshness, ...). */
  score: number;
}

/**
 * Per-cluster top-K retrieval with slot caps, so one dominant interest
 * cannot consume every candidate slot. Brute-force cosine: used by tests,
 * the offline harness and as the fallback when the vector index is
 * unavailable. Production retrieval uses Convex vectorSearch per cluster
 * with the same caps (queue generator, PR4).
 */
export function retrievePerCluster(
  vectors: ScoredVector[],
  clusters: InterestCluster[],
  perCluster: number,
  exclude: Set<number> = new Set(),
): Map<string, ScoredVector[]> {
  const out = new Map<string, ScoredVector[]>();
  for (const cluster of clusters) {
    const ranked = vectors
      .filter((entry) => !exclude.has(entry.repoId))
      .map((entry) => ({
        entry,
        sim: cosine(entry.vector, cluster.centroid),
      }))
      .sort((a, b) => b.sim - a.sim || a.entry.repoId - b.entry.repoId)
      .slice(0, Math.max(0, perCluster))
      .map(({ entry }) => entry);
    out.set(cluster.id, ranked);
  }
  return out;
}

export interface SemanticScores {
  /** Max weight-normalized similarity to any positive cluster. */
  best: number;
  /** Weight-averaged similarity across positive clusters. */
  weighted: number;
  /** Max similarity to the negative (disliked) region. */
  negative: number;
}

/**
 * Semantic relevance of one repository vector against the user model.
 * Cluster similarities are scaled by cluster share of total interest weight,
 * so a niche-but-real interest still moves its own candidates.
 */
export function scoreSemantic(
  vector: number[],
  clusters: InterestCluster[],
  negativeVectors: number[][] = [],
): SemanticScores {
  if (clusters.length === 0) {
    return {
      best: 0,
      weighted: 0,
      negative: maxSimilarity(vector, negativeVectors),
    };
  }
  const totalWeight = clusters.reduce(
    (sum, cluster) => sum + cluster.weight,
    0,
  );
  let best = 0;
  let weighted = 0;
  for (const cluster of clusters) {
    const sim = cosine(vector, cluster.centroid);
    const share = totalWeight > 0 ? cluster.weight / totalWeight : 0;
    best = Math.max(best, sim * (0.5 + 0.5 * share));
    weighted += sim * share;
  }
  return { best, weighted, negative: maxSimilarity(vector, negativeVectors) };
}

function maxSimilarity(vector: number[], others: number[][]): number {
  let best = 0;
  for (const other of others) best = Math.max(best, cosine(vector, other));
  return best;
}

/**
 * Adjacent-interest band: semantically near a cluster without being nearly
 * identical. Too close is repetitive, too far is random; the band between is
 * where serendipity lives. Operates on best-cluster similarity.
 */
export function inAdjacentBand(
  bestSimilarity: number,
  low = 0.35,
  high = 0.75,
): boolean {
  return bestSimilarity >= low && bestSimilarity <= high;
}

/**
 * Behavioural evidence strength for clustering: an enthusiastic, saved,
 * opened project anchors an interest; a bare view barely registers; negative
 * verdicts are excluded here (they feed the negative region instead).
 */
export function evidenceWeight(state: {
  value?: number;
  saved?: boolean;
  githubOpens?: number;
}): number {
  if (state.value !== undefined) {
    if (state.value >= 5) return 3;
    if (state.value >= 4) return 2;
    if (state.value >= 3) return 0.5;
    return 0;
  }
  let weight = 0;
  if (state.saved === true) weight += 1.5;
  weight += Math.min(state.githubOpens ?? 0, 2) * 0.3;
  return weight;
}

/**
 * Greedy semantic MMR: pick highest (score - λ·ΣcosineToChosen). Unlike the
 * facet MMR in rerank.ts this sees true content similarity, so two repos
 * sharing no topics but the same README substance still repel each other.
 * The penalty accumulates (same argument as the facet reranker): the fifth
 * copy of an idea pays five times. Default λ is provisional — PR5 tunes it
 * against the offline harness.
 */
export function selectSemanticWindow<T>(
  pool: { item: T; score: number; vector: number[] }[],
  size: number,
  lambda = 1.2,
): T[] {
  const chosen: { item: T; vector: number[] }[] = [];
  const remaining = [...pool];
  while (chosen.length < size && remaining.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index];
      let similarity = 0;
      for (const picked of chosen) {
        similarity += cosine(entry.vector, picked.vector);
      }
      const value = entry.score - lambda * similarity;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }
    const [picked] = remaining.splice(bestIndex, 1);
    chosen.push({ item: picked.item, vector: picked.vector });
  }
  return chosen.map((entry) => entry.item);
}
