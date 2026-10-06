import { getAuthUserId } from "@convex-dev/auth/server";
import { Infer, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";

/**
 * Shape of a repository as scraped from the GitHub search API. Shared between
 * the `github` action (which fetches) and `saveDiscoveredRepos` (which stores),
 * so both sides always agree on the contract.
 */
export const discoveredRepoValidator = v.object({
  repoId: v.number(),
  fullName: v.string(),
  owner: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  url: v.string(),
  homepage: v.optional(v.string()),
  stars: v.number(),
  forks: v.number(),
  openIssues: v.number(),
  language: v.optional(v.string()),
  topics: v.array(v.string()),
  license: v.optional(v.string()),
  pushedAt: v.optional(v.number()),
  archived: v.boolean(),
});

export type DiscoveredRepo = Infer<typeof discoveredRepoValidator>;

/** GitHub topics are lowercase alphanumerics joined by single hyphens. */
export function normalizeTopic(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 50);
  return cleaned.replace(/^-+/, "").replace(/-+$/, "");
}

/** The topics the signed-in user is following, oldest first. */
export const listTopics = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const topics = await ctx.db
      .query("topics")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return topics.sort((a, b) => a.createdAt - b.createdAt);
  },
});

/** The shape every project row is rendered from, rating included. */
function toProject(repo: Doc<"repos">, rating: number | null) {
  return {
    repoId: repo.repoId,
    fullName: repo.fullName,
    owner: repo.owner,
    name: repo.name,
    description: repo.description ?? null,
    url: repo.url,
    stars: repo.stars,
    forks: repo.forks,
    language: repo.language ?? null,
    topics: repo.topics,
    pushedAt: repo.pushedAt ?? null,
    archived: repo.archived,
    firstSeenAt: repo.firstSeenAt,
    discoveredVia: repo.discoveredVia,
    rating,
  };
}

async function ratingsForUser(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Map<number, number>> {
  const ratings = await ctx.db
    .query("ratings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return new Map(ratings.map((rating) => [rating.repoId, rating.value]));
}

function countBy(
  values: Iterable<string>,
  counts: Map<string, number>,
): void {
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
}

function facets(
  counts: Map<string, number>,
  limit: number,
): { name: string; count: number }[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

/**
 * The dashboard feed: every cached project that arrived through one of the
 * user's topics, with the user's interest rating attached (null when unrated).
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const topics = await ctx.db
      .query("topics")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const slugs = topics.map((topic) => topic.slug);
    const slugSet = new Set(slugs);

    const ratingByRepo = await ratingsForUser(ctx, userId);
    const repoDocs = await ctx.db.query("repos").collect();
    const items = repoDocs
      .filter((repo) => repo.discoveredVia.some((slug) => slugSet.has(slug)))
      .map((repo) => toProject(repo, ratingByRepo.get(repo.repoId) ?? null));

    const counts: Record<string, number> = {};
    for (const slug of slugs) counts[slug] = 0;
    for (const item of items) {
      for (const slug of item.discoveredVia) {
        if (slug in counts) counts[slug] += 1;
      }
    }

    return {
      items,
      counts,
      total: items.length,
      rated: items.filter((item) => item.rating !== null).length,
    };
  },
});

/**
 * The catalog: every project fetched so far, not only the ones in the current
 * feed, so old topics stay browsable and searchable.
 */
export const catalog = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const ratingByRepo = await ratingsForUser(ctx, userId);
    const repoDocs = await ctx.db.query("repos").collect();
    const items = repoDocs.map((repo) =>
      toProject(repo, ratingByRepo.get(repo.repoId) ?? null),
    );

    const languageCounts = new Map<string, number>();
    const topicCounts = new Map<string, number>();
    for (const repo of repoDocs) {
      if (repo.language) countBy([repo.language], languageCounts);
      countBy(repo.topics, topicCounts);
    }

    return {
      items,
      total: items.length,
      rated: items.filter((item) => item.rating !== null).length,
      languages: facets(languageCounts, 8),
      topics: facets(topicCounts, 14),
    };
  },
});

/** Add a topic to the user's list. Idempotent. */
export const addTopic = mutation({
  args: { topic: v.string() },
  handler: async (ctx, { topic }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to pick topics.");
    const slug = normalizeTopic(topic);
    if (!slug) throw new Error('Enter a topic like "rust" or "devtools".');

    const existing = await ctx.db
      .query("topics")
      .withIndex("by_user_slug", (q) =>
        q.eq("userId", userId).eq("slug", slug),
      )
      .unique();
    if (existing) return { slug, created: false };

    await ctx.db.insert("topics", {
      userId,
      slug,
      createdAt: Date.now(),
    });
    return { slug, created: true };
  },
});

/** Stop following a topic. Cached repos are kept so ratings survive. */
export const removeTopic = mutation({
  args: { topicId: v.id("topics") },
  handler: async (ctx, { topicId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to edit topics.");
    const topic = await ctx.db.get(topicId);
    if (!topic || topic.userId !== userId) return null;
    await ctx.db.delete(topicId);
    return topic.slug;
  },
});

/** Record how interested the user is in a project (1 = low, 5 = high). */
export const setRating = mutation({
  args: { repoId: v.number(), value: v.number() },
  handler: async (ctx, { repoId, value }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to rate projects.");
    const clamped = Math.max(1, Math.min(5, Math.round(value)));
    const now = Date.now();

    const existing = await ctx.db
      .query("ratings")
      .withIndex("by_user_repo", (q) =>
        q.eq("userId", userId).eq("repoId", repoId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { value: clamped, updatedAt: now });
    } else {
      await ctx.db.insert("ratings", {
        userId,
        repoId,
        value: clamped,
        createdAt: now,
        updatedAt: now,
      });
    }
    return clamped;
  },
});

/** Remove a rating so the project is unrated again. */
export const clearRating = mutation({
  args: { repoId: v.number() },
  handler: async (ctx, { repoId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to rate projects.");
    const existing = await ctx.db
      .query("ratings")
      .withIndex("by_user_repo", (q) =>
        q.eq("userId", userId).eq("repoId", repoId),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

/* ------------------------------------------------------------------ *
 * Internal functions used by the GitHub action (actions have no db).  *
 * ------------------------------------------------------------------ */

export const saveDiscoveredRepos = internalMutation({
  args: {
    userId: v.id("users"),
    topicSlug: v.string(),
    repos: v.array(discoveredRepoValidator),
  },
  handler: async (ctx, { userId, topicSlug, repos }) => {
    const now = Date.now();
    let added = 0;
    let newForUser = 0;

    for (const repo of repos) {
      const existing = await ctx.db
        .query("repos")
        .withIndex("by_repo_id", (q) => q.eq("repoId", repo.repoId))
        .unique();

      if (existing) {
        if (!existing.discoveredVia.includes(topicSlug)) {
          newForUser += 1;
          await ctx.db.patch(existing._id, {
            ...repo,
            discoveredVia: [...existing.discoveredVia, topicSlug],
            updatedAt: now,
          });
        } else {
          await ctx.db.patch(existing._id, { ...repo, updatedAt: now });
        }
      } else {
        added += 1;
        newForUser += 1;
        await ctx.db.insert("repos", {
          ...repo,
          discoveredVia: [topicSlug],
          firstSeenAt: now,
          updatedAt: now,
        });
      }
    }

    const topic = await ctx.db
      .query("topics")
      .withIndex("by_user_slug", (q) =>
        q.eq("userId", userId).eq("slug", topicSlug),
      )
      .unique();
    if (topic) {
      await ctx.db.patch(topic._id, {
        lastSyncedAt: now,
        lastSyncError: undefined,
      });
    }

    return { added, refreshed: repos.length, newForUser };
  },
});

export const markTopicError = internalMutation({
  args: {
    userId: v.id("users"),
    topicSlug: v.string(),
    message: v.string(),
  },
  handler: async (ctx, { userId, topicSlug, message }) => {
    const topic = await ctx.db
      .query("topics")
      .withIndex("by_user_slug", (q) =>
        q.eq("userId", userId).eq("slug", topicSlug),
      )
      .unique();
    if (topic) await ctx.db.patch(topic._id, { lastSyncError: message });
    return null;
  },
});

export const topicSlugsForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const topics = await ctx.db
      .query("topics")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return topics.sort((a, b) => a.createdAt - b.createdAt).map((t) => t.slug);
  },
});
