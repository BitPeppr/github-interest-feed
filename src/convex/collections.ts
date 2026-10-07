import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { findRepo, interactionsForUser, toProject } from "./feed";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

/** A shelf can hold plenty — but not the whole catalog. */
const MAX_COLLECTION_SIZE = 200;
/** How many projects a public shelf shows. */
const SHELF_SIZE = 12;

async function requireUser(ctx: QueryCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Sign in first.");
  return userId;
}

async function ownCollection(
  ctx: MutationCtx,
  collectionId: Id<"collections">,
  userId: Id<"users">,
): Promise<Doc<"collections">> {
  const collection = await ctx.db.get(collectionId);
  if (!collection || collection.userId !== userId) {
    throw new Error("That collection does not exist.");
  }
  return collection;
}

function displayName(user: Doc<"users"> | null): string {
  return user?.name ?? user?.email?.split("@")[0] ?? "A Gitbook user";
}

/** The signed-in user's own collections, newest first. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const collections = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return collections
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((collection) => ({
        _id: collection._id,
        name: collection.name,
        description: collection.description ?? null,
        isPublic: collection.isPublic,
        repoIds: collection.repoIds,
        count: collection.repoIds.length,
        updatedAt: collection.updatedAt,
      }));
  },
});

export const create = mutation({
  args: { name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, { name, description }) => {
    const userId = await requireUser(ctx);
    const clean = name.trim().slice(0, 60);
    if (!clean) throw new Error("Give the collection a name.");
    const now = Date.now();
    return await ctx.db.insert("collections", {
      userId,
      name: clean,
      description: description?.trim().slice(0, 240) || undefined,
      repoIds: [],
      isPublic: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    collectionId: v.id("collections"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, { collectionId, name, description, isPublic }) => {
    const userId = await requireUser(ctx);
    const collection = await ownCollection(ctx, collectionId, userId);
    const patch: Partial<Omit<Doc<"collections">, "_id" | "_creationTime">> = {
      updatedAt: Date.now(),
    };
    if (name !== undefined) {
      const clean = name.trim().slice(0, 60);
      if (!clean) throw new Error("Give the collection a name.");
      patch.name = clean;
    }
    if (description !== undefined) {
      patch.description = description.trim().slice(0, 240) || undefined;
    }
    if (isPublic !== undefined) patch.isPublic = isPublic;
    await ctx.db.patch(collection._id, patch);
    return collection._id;
  },
});

export const addProject = mutation({
  args: { collectionId: v.id("collections"), repoId: v.number() },
  handler: async (ctx, { collectionId, repoId }) => {
    const userId = await requireUser(ctx);
    const collection = await ownCollection(ctx, collectionId, userId);
    if (collection.repoIds.includes(repoId)) return collection._id;
    if (collection.repoIds.length >= MAX_COLLECTION_SIZE) {
      throw new Error("This collection is full.");
    }
    await ctx.db.patch(collection._id, {
      repoIds: [...collection.repoIds, repoId],
      updatedAt: Date.now(),
    });
    return collection._id;
  },
});

export const removeProject = mutation({
  args: { collectionId: v.id("collections"), repoId: v.number() },
  handler: async (ctx, { collectionId, repoId }) => {
    const userId = await requireUser(ctx);
    const collection = await ownCollection(ctx, collectionId, userId);
    await ctx.db.patch(collection._id, {
      repoIds: collection.repoIds.filter((id) => id !== repoId),
      updatedAt: Date.now(),
    });
    return collection._id;
  },
});

export const remove = mutation({
  args: { collectionId: v.id("collections") },
  handler: async (ctx, { collectionId }) => {
    const userId = await requireUser(ctx);
    const collection = await ownCollection(ctx, collectionId, userId);
    await ctx.db.delete(collection._id);
    return collection._id;
  },
});

/** A shared collection page — public ones, or the owner previewing their own. */
export const shared = query({
  args: { collectionId: v.id("collections") },
  handler: async (ctx, { collectionId }) => {
    const collection = await ctx.db.get(collectionId);
    if (!collection) return null;
    const viewerId = await getAuthUserId(ctx);
    if (!collection.isPublic && collection.userId !== viewerId) return null;

    const owner = await ctx.db.get(collection.userId);
    const interactions = viewerId
      ? await interactionsForUser(ctx, viewerId)
      : new Map<number, Doc<"ratings">>();
    const items: ReturnType<typeof toProject>[] = [];
    for (const repoId of collection.repoIds) {
      const repo = await findRepo(ctx, repoId);
      if (repo) items.push(toProject(repo, interactions.get(repoId) ?? null));
    }
    return {
      name: collection.name,
      description: collection.description ?? null,
      isPublic: collection.isPublic,
      ownerName: displayName(owner),
      ownerUserId: collection.userId,
      items,
    };
  },
});

/** Profile settings for the signed-in user. Private until they say otherwise. */
export const myProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return {
      isPublic: profile?.isPublic === true,
      bio: profile?.bio ?? null,
    };
  },
});

export const setProfile = mutation({
  args: { isPublic: v.boolean(), bio: v.optional(v.string()) },
  handler: async (ctx, { isPublic, bio }) => {
    const userId = await requireUser(ctx);
    const clean = bio?.trim().slice(0, 200) || undefined;
    const now = Date.now();
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { isPublic, bio: clean, updatedAt: now });
    } else {
      await ctx.db.insert("profiles", {
        userId,
        isPublic,
        bio: clean,
        updatedAt: now,
      });
    }
    return isPublic;
  },
});

/** The shelf at /u/:userId. Opt-in only: ratings stay private by default. */
export const publicProfile = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const viewerId = await getAuthUserId(ctx);
    const isOwner = viewerId === userId;
    if (profile?.isPublic !== true && !isOwner) return null;

    const owner = await ctx.db.get(userId);
    const rows = await ctx.db
      .query("ratings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const repos = new Map(
      (await ctx.db.query("repos").collect()).map((repo) => [repo.repoId, repo]),
    );

    // The shelf: the projects they rated 4-5, best and earliest first.
    const shelf = rows
      .filter((row) => (row.value ?? 0) >= 4 && row.hidden !== true)
      .sort(
        (a, b) => (b.value ?? 0) - (a.value ?? 0) || a.createdAt - b.createdAt,
      )
      .slice(0, SHELF_SIZE)
      .map((row) => {
        const repo = repos.get(row.repoId);
        return repo ? toProject(repo, row) : null;
      })
      .filter((item) => item !== null);

    const collections = (
      await ctx.db
        .query("collections")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    )
      .filter((collection) => collection.isPublic)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((collection) => ({
        _id: collection._id,
        name: collection.name,
        description: collection.description ?? null,
        count: collection.repoIds.length,
      }));

    return {
      isPublic: profile?.isPublic === true,
      isOwner,
      name: displayName(owner),
      bio: profile?.bio ?? null,
      shelf,
      collections,
    };
  },
});

/** A year in review: the numbers behind someone's taste. */
export const wrapped = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const rows = await ctx.db
      .query("ratings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const repos = new Map(
      (await ctx.db.query("repos").collect()).map((repo) => [repo.repoId, repo]),
    );

    // Imported stars are taste, not deliberate ratings: they get their own
    // line instead of inflating the rating totals.
    const rated = rows.filter(
      (row) => typeof row.value === "number" && row.implicit !== true,
    );
    const imported = rows.filter((row) => row.implicit === true).length;

    const languageCounts = new Map<string, number>();
    const topicCounts = new Map<string, number>();
    let totalStars = 0;
    for (const row of rated) {
      const repo = repos.get(row.repoId);
      if (!repo) continue;
      totalStars += repo.stars;
      if (repo.language) {
        languageCounts.set(
          repo.language,
          (languageCounts.get(repo.language) ?? 0) + 1,
        );
      }
      if ((row.value ?? 0) >= 4) {
        for (const topic of repo.topics) {
          topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
        }
      }
    }

    const topLanguage =
      [...languageCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const topTopics = [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([topic]) => topic);

    const byAge = [...rated].sort((a, b) => a.createdAt - b.createdAt);
    const first = byAge[0];
    const firstRepo = first ? repos.get(first.repoId) : undefined;
    const topPickRow = [...rated].sort(
      (a, b) => (b.value ?? 0) - (a.value ?? 0) || a.createdAt - b.createdAt,
    )[0];
    const topPickRepo = topPickRow ? repos.get(topPickRow.repoId) : undefined;

    return {
      totalRated: rated.length,
      saved: rows.filter((row) => row.saved === true).length,
      hidden: rows.filter((row) => row.hidden === true).length,
      imported,
      averageInterest: rated.length
        ? Math.round(
            (rated.reduce((sum, row) => sum + (row.value ?? 0), 0) /
              rated.length) *
              10,
          ) / 10
        : null,
      topLanguage,
      topTopics,
      totalStars,
      firstSighting: firstRepo
        ? {
            fullName: firstRepo.fullName,
            value: first?.value ?? null,
            at: first?.createdAt ?? null,
          }
        : null,
      topPick: topPickRepo
        ? { fullName: topPickRepo.fullName, value: topPickRow?.value ?? null }
        : null,
    };
  },
});
