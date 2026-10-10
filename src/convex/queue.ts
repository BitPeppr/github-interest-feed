/**
 * Persisted feed queue: generate in the background (action), serve bounded
 * reads (query), consume on advance (mutation).
 *
 * ```text
 * open feed → peek next queued cards (bounded read)
 * advance   → consume (delete served rows; schedule generation when shallow)
 * generate  → candidates → rank → rerank → persist batch + instrumentation
 * ```
 *
 * The reactive `discovery` query in feed.ts stays as a fallback and for
 * evaluation; the UI reads from the queue.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { toProject } from "./feed";
import {
  ADJACENT_PER_CLUSTER,
  ADJACENT_SKIP_TOP,
  CATALOG_PAGE,
  CLUSTER_JOIN_THRESHOLD,
  GENERATION_SCAN_CAP,
  GEN_BATCH,
  MAX_INTEREST_CLUSTERS,
  METADATA_VECTOR_FETCH,
  QUEUE_CAP,
  QUEUE_LOW_WATER,
  SEMANTIC_PER_CLUSTER,
  VECTOR_FETCH_CHUNK,
} from "./recommender/constants";
import {
  dedupeSourced,
  freshRepos,
  longTailRepos,
  topicMatchedRepos,
  type SourcedRepo,
} from "./recommender/candidates";
import { buildSignals } from "./recommender/signals";
import { planQueueBatch } from "./recommender/queueplan";
import type { RepoSnapshot } from "./recommender/types";
import {
  buildInterestClusters,
  labelClusters,
  type InterestCluster,
} from "./recommender/vectors";

/** Compact catalog row: everything scoring needs, nothing it doesn't. */
interface CompactRepo {
  repoId: number;
  owner: string;
  name: string;
  stars: number;
  forks: number;
  openIssues: number;
  language?: string;
  topics: string[];
  pushedAt?: number;
  archived: boolean;
}

function compactToSnapshot(row: CompactRepo): RepoSnapshot {
  return {
    repoId: row.repoId,
    fullName: `${row.owner}/${row.name}`,
    owner: row.owner,
    name: row.name,
    stars: row.stars,
    forks: row.forks,
    openIssues: row.openIssues,
    language: row.language,
    topics: row.topics,
    pushedAt: row.pushedAt,
    archived: row.archived,
    discoveredVia: [],
  };
}

/* ------------------------------------------------------------------ *
 * Internal data access for the generator                               *
 * ------------------------------------------------------------------ */

/** One bounded catalog page, ordered by repoId (cursor-paged, fully covering). */
export const catalogPage = internalQuery({
  args: { cursor: v.number(), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const page = Math.max(1, Math.min(limit, CATALOG_PAGE));
    const repos = await ctx.db
      .query("repos")
      .withIndex("by_repo_id", (q) => q.gt("repoId", cursor))
      .take(page);
    const items: CompactRepo[] = repos.map((repo) => ({
      repoId: repo.repoId,
      owner: repo.owner,
      name: repo.name,
      stars: repo.stars,
      forks: repo.forks,
      openIssues: repo.openIssues,
      language: repo.language,
      topics: repo.topics,
      pushedAt: repo.pushedAt,
      archived: repo.archived,
    }));
    const last = repos[repos.length - 1]?.repoId ?? null;
    return { items, nextCursor: repos.length < page ? null : last };
  },
});

/** Snapshots for explicit IDs (bounded input). Missing/archived rows drop out. */
export const snapshotsForIds = internalQuery({
  args: { repoIds: v.array(v.number()) },
  handler: async (ctx, { repoIds }) => {
    const unique = [...new Set(repoIds)].slice(0, 200);
    const out: CompactRepo[] = [];
    for (const repoId of unique) {
      const repo = await ctx.db
        .query("repos")
        .withIndex("by_repo_id", (q) => q.eq("repoId", repoId))
        .unique();
      if (!repo || repo.archived) continue;
      out.push({
        repoId: repo.repoId,
        owner: repo.owner,
        name: repo.name,
        stars: repo.stars,
        forks: repo.forks,
        openIssues: repo.openIssues,
        language: repo.language,
        topics: repo.topics,
        pushedAt: repo.pushedAt,
        archived: repo.archived,
      });
    }
    return { items: out };
  },
});

/** Everything the generator needs about the user in one call. */
export const userTaste = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("ratings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const topics = await ctx.db
      .query("topics")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const queued = await ctx.db
      .query("feedQueue")
      .withIndex("by_user_rank", (q) => q.eq("userId", userId))
      .collect();
    const profile = await ctx.db
      .query("userRecProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return {
      rated: rows.map((row) => ({
        repoId: row.repoId,
        value: row.value,
        saved: row.saved,
        hidden: row.hidden,
        githubOpens: row.githubOpens,
        readmeOpens: row.readmeOpens,
      })),
      followed: topics.map((topic) => topic.slug),
      queued: queued.map((row) => row.repoId),
      feedVersion: profile?.feedVersion ?? 0,
    };
  },
});

/** Embedding vectors for explicit IDs (caller chunks; bounded per call). */
export const vectorsForIds = internalQuery({
  args: { repoIds: v.array(v.number()) },
  handler: async (ctx, { repoIds }) => {
    const unique = [...new Set(repoIds)].slice(0, VECTOR_FETCH_CHUNK);
    const out: { repoId: number; vector: number[] }[] = [];
    for (const repoId of unique) {
      const row = await ctx.db
        .query("repoEmbeddings")
        .withIndex("by_repo_id", (q) => q.eq("repoId", repoId))
        .unique();
      if (row) out.push({ repoId, vector: row.embedding });
    }
    return { items: out };
  },
});

export const saveClusters = internalMutation({
  args: {
    userId: v.id("users"),
    clusters: v.array(
      v.object({
        clusterId: v.string(),
        centroid: v.array(v.float64()),
        weight: v.number(),
        repoIds: v.array(v.number()),
        label: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { userId, clusters }) => {
    const existing = await ctx.db
      .query("interestClusters")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    const now = Date.now();
    for (const cluster of clusters) {
      await ctx.db.insert("interestClusters", {
        userId,
        clusterId: cluster.clusterId,
        centroid: cluster.centroid,
        weight: cluster.weight,
        repoIds: cluster.repoIds,
        label: cluster.label,
        updatedAt: now,
      });
    }
    return { saved: clusters.length };
  },
});

export const saveQueueBatch = internalMutation({
  args: {
    userId: v.id("users"),
    items: v.array(
      v.object({
        repoId: v.number(),
        score: v.number(),
        reasons: v.array(v.string()),
        sources: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, { userId, items }) => {
    const current = await ctx.db
      .query("feedQueue")
      .withIndex("by_user_rank", (q) => q.eq("userId", userId))
      .collect();
    const queuedIds = new Set(current.map((row) => row.repoId));
    const maxRank = current.reduce((max, row) => Math.max(max, row.rank), -1);
    const room = Math.max(0, QUEUE_CAP - current.length);
    const now = Date.now();
    let added = 0;
    for (const item of items.slice(0, room)) {
      if (queuedIds.has(item.repoId)) continue;
      await ctx.db.insert("feedQueue", {
        userId,
        repoId: item.repoId,
        rank: maxRank + 1 + added,
        score: item.score,
        reasons: item.reasons,
        sources: item.sources,
        generatedAt: now,
      });
      queuedIds.add(item.repoId);
      added += 1;
    }
    return { added, depth: current.length + added };
  },
});

export const updateMeta = internalMutation({
  args: {
    userId: v.id("users"),
    depth: v.number(),
    durationMs: v.number(),
    poolSize: v.number(),
    coverage: v.number(),
    counts: v.array(v.object({ key: v.string(), count: v.number() })),
    profileVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, ...rest } = args;
    const now = Date.now();
    const existing = await ctx.db
      .query("queueMeta")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...rest,
        lastGeneratedAt: now,
        lastDurationMs: rest.durationMs,
        lastPoolSize: rest.poolSize,
        lastCoverage: rest.coverage,
        lastCounts: rest.counts,
        updatedAt: now,
      });
      return;
    }
    await ctx.db.insert("queueMeta", {
      userId,
      ...rest,
      lastGeneratedAt: now,
      lastDurationMs: rest.durationMs,
      lastPoolSize: rest.poolSize,
      lastCoverage: rest.coverage,
      lastCounts: rest.counts,
      updatedAt: now,
    });
  },
});

/* ------------------------------------------------------------------ *
 * Serving: peek (pure read) + consume (delete + replenish)             *
 * ------------------------------------------------------------------ */

/** Next queued cards, cheapest read in the system: one bounded index scan. */
export const peek = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const count = Math.max(1, Math.min(limit ?? 24, 48));

    const rows = await ctx.db
      .query("feedQueue")
      .withIndex("by_user_rank", (q) => q.eq("userId", userId))
      .take(count);
    const depthRows = await ctx.db
      .query("feedQueue")
      .withIndex("by_user_rank", (q) => q.eq("userId", userId))
      .collect();
    const meta = await ctx.db
      .query("queueMeta")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const catalogProbe = await ctx.db
      .query("repos")
      .withIndex("by_repo_id", (q) => q.gt("repoId", 0))
      .take(1);

    const cards = [];
    for (const row of rows) {
      const repo = await ctx.db
        .query("repos")
        .withIndex("by_repo_id", (q) => q.eq("repoId", row.repoId))
        .unique();
      if (!repo) continue;
      const interaction = await ctx.db
        .query("ratings")
        .withIndex("by_user_repo", (q) =>
          q.eq("userId", userId).eq("repoId", row.repoId),
        )
        .unique();
      cards.push(toProject(repo, interaction, row.reasons));
    }
    const ratedRows = await ctx.db
      .query("ratings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return {
      cards,
      depth: depthRows.length,
      rated: ratedRows.filter((row) => typeof row.value === "number").length,
      catalogEmpty: catalogProbe.length === 0,
      meta: meta
        ? {
            lastGeneratedAt: meta.lastGeneratedAt ?? null,
            lastDurationMs: meta.lastDurationMs ?? null,
            lastPoolSize: meta.lastPoolSize ?? null,
            lastCoverage: meta.lastCoverage ?? null,
            profileVersion: meta.profileVersion,
          }
        : null,
    };
  },
});

/**
 * Delete served rows and schedule a background refill when shallow. The
 * client calls this as cards scroll by; generation never blocks serving.
 * A server-side cooldown stops an exhausted catalog from regenerating on
 * every advance.
 */
const GENERATE_SERVER_COOLDOWN_MS = 60_000;

export const consume = mutation({
  args: { repoIds: v.array(v.number()) },
  handler: async (ctx, { repoIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const unique = [...new Set(repoIds)].slice(0, 60);
    let consumed = 0;
    for (const repoId of unique) {
      const row = await ctx.db
        .query("feedQueue")
        .withIndex("by_user_repo", (q) =>
          q.eq("userId", userId).eq("repoId", repoId),
        )
        .unique();
      if (row) {
        await ctx.db.delete(row._id);
        consumed += 1;
      }
    }
    const remaining = await ctx.db
      .query("feedQueue")
      .withIndex("by_user_rank", (q) => q.eq("userId", userId))
      .collect();
    let scheduled = false;
    if (remaining.length < QUEUE_LOW_WATER) {
      const meta = await ctx.db
        .query("queueMeta")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      const cooled =
        !meta?.lastGeneratedAt ||
        Date.now() - meta.lastGeneratedAt > GENERATE_SERVER_COOLDOWN_MS;
      if (cooled) {
        await ctx.scheduler.runAfter(0, internal.queue.generate, {});
        scheduled = true;
      }
    }
    return { consumed, depth: remaining.length, scheduled };
  },
});

/* ------------------------------------------------------------------ *
 * Generation (background action)                                      *
 * ------------------------------------------------------------------ */

async function readCatalog(
  ctx: ActionCtx,
): Promise<{ snapshots: RepoSnapshot[]; scanned: number }> {
  const snapshots: RepoSnapshot[] = [];
  let cursor = 0;
  let scanned = 0;
  for (;;) {
    const page: { items: CompactRepo[]; nextCursor: number | null } =
      await ctx.runQuery(internal.queue.catalogPage, {
        cursor,
        limit: CATALOG_PAGE,
      });
    for (const row of page.items) snapshots.push(compactToSnapshot(row));
    scanned += page.items.length;
    if (page.nextCursor === null || scanned >= GENERATION_SCAN_CAP) break;
    cursor = page.nextCursor;
  }
  return { snapshots, scanned };
}

export const generate = action({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, { batchSize }) => {
    const started = Date.now();
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to generate your feed.");
    const now = Date.now();

    const taste: {
      rated: {
        repoId: number;
        value?: number;
        saved?: boolean;
        hidden?: boolean;
        githubOpens?: number;
        readmeOpens?: number;
      }[];
      followed: string[];
      queued: number[];
      feedVersion: number;
    } = await ctx.runQuery(internal.queue.userTaste, { userId });
    if (taste.queued.length >= QUEUE_LOW_WATER) {
      return { generated: 0, reason: "deep-enough" as const };
    }
    const { snapshots, scanned } = await readCatalog(ctx);
    if (snapshots.length === 0) {
      return { generated: 0, reason: "empty-catalog" as const };
    }
    const byId = new Map(snapshots.map((repo) => [repo.repoId, repo]));

    // Signals from history (rows whose repo left the catalog still block it).
    const rated = [];
    for (const row of taste.rated) {
      const repo = byId.get(row.repoId);
      if (!repo) continue;
      rated.push({ repo, ...row });
    }
    const signals = buildSignals(now, rated);
    const followed = new Set(taste.followed);
    const touched = new Set([
      ...taste.rated.map((row) => row.repoId),
      ...taste.queued,
    ]);
    const unseen = snapshots.filter(
      (repo) => !repo.archived && !touched.has(repo.repoId),
    );

    // Multi-interest model from positive-evidence embeddings.
    const {
      positives,
      negatives,
    }: {
      positives: { repoId: number; vector: number[]; weight: number }[];
      negatives: number[][];
    } = await ctx.runQuery(internal.embeddings.clusteringData, { userId });
    const freshPositives = positives.filter((entry) => byId.has(entry.repoId));
    const clusters: InterestCluster[] = labelClusters(
      buildInterestClusters(freshPositives, now, {
        maxClusters: MAX_INTEREST_CLUSTERS,
        joinThreshold: CLUSTER_JOIN_THRESHOLD,
      }),
      byId,
    );
    await ctx.runMutation(internal.queue.saveClusters, {
      userId,
      clusters: clusters.map((cluster) => ({
        clusterId: cluster.id,
        centroid: cluster.centroid,
        weight: cluster.weight,
        repoIds: cluster.repoIds,
        label: cluster.label,
      })),
    });

    // Semantic + adjacent candidates via the vector index (no bulk transfer:
    // the index does the searching, we fetch only the winners).
    const extraCandidates: SourcedRepo[] = [];
    if (clusters.length > 0) {
      for (const cluster of clusters) {
        const hits: { _id: Id<"repoEmbeddings">; _score: number }[] =
          await ctx.vectorSearch("repoEmbeddings", "by_embedding", {
            vector: cluster.centroid,
            limit: ADJACENT_SKIP_TOP + ADJACENT_PER_CLUSTER,
          });
        const { repoIds }: { repoIds: number[] } = await ctx.runQuery(
          internal.queue.embeddingRepoIds,
          { ids: hits.map((hit) => hit._id) },
        );
        const fresh = repoIds.filter((repoId) => {
          if (touched.has(repoId)) return false;
          const repo = byId.get(repoId);
          return repo !== undefined && !repo.archived;
        });
        const semanticIds = fresh.slice(0, SEMANTIC_PER_CLUSTER);
        const adjacentIds = fresh.slice(
          ADJACENT_SKIP_TOP,
          ADJACENT_SKIP_TOP + ADJACENT_PER_CLUSTER,
        );
        const found: { items: CompactRepo[] } = await ctx.runQuery(
          internal.queue.snapshotsForIds,
          {
            repoIds: [...semanticIds, ...adjacentIds],
          },
        );
        const snapById = new Map(
          found.items.map((row) => [row.repoId, compactToSnapshot(row)]),
        );
        for (const repoId of semanticIds) {
          const repo = snapById.get(repoId);
          if (repo) extraCandidates.push({ repo, sources: ["semantic"] });
        }
        for (const repoId of adjacentIds) {
          const repo = snapById.get(repoId);
          if (repo) extraCandidates.push({ repo, sources: ["adjacent"] });
        }
      }
    }
    const extraUnion = dedupeSourced([extraCandidates]);

    // Vectors for scoring: semantic/adjacent winners + top metadata by stars
    // (proxy for pool membership; bounded total transfer).
    const metadataProbe = dedupeSourced([
      topicMatchedRepos(unseen, signals, followed, 60),
      freshRepos(unseen, now, 40),
      longTailRepos(unseen, 40),
    ]);
    const probeIds = [
      ...new Set(metadataProbe.map((entry) => entry.repo.repoId)),
    ]
      .sort((a, b) => (byId.get(b)?.stars ?? 0) - (byId.get(a)?.stars ?? 0))
      .slice(0, METADATA_VECTOR_FETCH);
    const vectorIds = [
      ...new Set([
        ...extraUnion.map((entry) => entry.repo.repoId),
        ...probeIds,
      ]),
    ].slice(0, 250);
    const vectorsByRepo = new Map<number, number[]>();
    for (let start = 0; start < vectorIds.length; start += VECTOR_FETCH_CHUNK) {
      const chunk: { items: { repoId: number; vector: number[] }[] } =
        await ctx.runQuery(internal.queue.vectorsForIds, {
          repoIds: vectorIds.slice(start, start + VECTOR_FETCH_CHUNK),
        });
      for (const row of chunk.items) vectorsByRepo.set(row.repoId, row.vector);
    }

    const plan = planQueueBatch({
      unseen,
      signals,
      followedTopics: followed,
      clusters,
      vectorsByRepo,
      negativeVectors: negatives,
      extraCandidates: extraUnion,
      caps: { batch: batchSize ?? GEN_BATCH },
    });

    const saved = await ctx.runMutation(internal.queue.saveQueueBatch, {
      userId,
      items: plan.items.map((item) => ({
        repoId: item.repoId,
        score: item.score,
        reasons: item.reasons,
        sources: item.sources,
      })),
    });
    const counts = Object.entries(plan.stats.candidateBySource).map(
      ([key, count]) => ({ key, count }),
    );
    await ctx.runMutation(internal.queue.updateMeta, {
      userId,
      depth: saved.depth,
      durationMs: Date.now() - started,
      poolSize: plan.stats.poolSize,
      coverage: plan.stats.semanticCoverage,
      counts,
      profileVersion: taste.feedVersion,
    });
    return {
      generated: saved.added,
      depth: saved.depth,
      scanned,
      clusters: clusters.length,
      stats: plan.stats,
      durationMs: Date.now() - started,
    };
  },
});

/** Resolve embedding rows to their repoIds in one bounded call. */
export const embeddingRepoIds = internalQuery({
  args: { ids: v.array(v.id("repoEmbeddings")) },
  handler: async (ctx, { ids }) => {
    const out: number[] = [];
    for (const id of ids.slice(0, 256)) {
      const doc = await ctx.db.get(id);
      if (doc) out.push(doc.repoId);
    }
    return { repoIds: out };
  },
});
