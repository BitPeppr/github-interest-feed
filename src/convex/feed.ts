import { getAuthUserId } from "@convex-dev/auth/server";
import { Infer, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
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

/**
 * Broad topics the feed can explore on its own. They keep the discovery feed
 * endless even when the user has followed no topics at all.
 *
 * Breadth matters more than depth here: a topic is the only door into the
 * catalog, and the first version of this list was thirty web/ML keywords, so
 * every card arrived from the same few corners of GitHub. It is grouped by
 * domain purely for readability.
 */
export const DEFAULT_TOPICS = [
  // Languages and runtimes
  "typescript",
  "javascript",
  "python",
  "rust",
  "go",
  "c",
  "cpp",
  "java",
  "kotlin",
  "swift",
  "ruby",
  "php",
  "elixir",
  "haskell",
  "lua",
  "zig",
  "ocaml",
  "scala",
  "clojure",
  "r",
  "julia",
  "dart",
  "csharp",
  "fortran",
  "nim",
  "crystal",
  "webassembly",

  // Terminals, editors and the desktop
  "cli",
  "tui",
  "terminal",
  "shell",
  "zsh",
  "bash",
  "fish-shell",
  "vim",
  "neovim",
  "emacs",
  "text-editor",
  "dotfiles",
  "window-manager",
  "status-bar",
  "tmux",
  "screensaver",
  "wallpaper",
  "fonts",
  "typography",

  // Systems, hardware and infrastructure
  "operating-system",
  "kernel",
  "unix",
  "filesystem",
  "embedded",
  "microcontroller",
  "arduino",
  "raspberry-pi",
  "firmware",
  "electronics",
  "keyboard",
  "mechanical-keyboard",
  "qmk",
  "ergonomic-keyboard",
  "3d-printing",
  "cad",
  "robotics",
  "drones",
  "iot",
  "smart-home",
  "home-automation",
  "homelab",
  "self-hosted",
  "system-monitoring",
  "observability",
  "infrastructure",
  "devops",
  "docker",
  "kubernetes",
  "networking",
  "vpn",
  "proxy",
  "p2p",
  "backup",
  "encryption",
  "cryptography",
  "reverse-engineering",
  "security",
  "compilers",
  "interpreters",
  "virtual-machine",
  "emulator",
  "retro-computing",
  "assembly",
  "concurrency",
  "distributed-systems",

  // Science, maths and data
  "scientific-computing",
  "simulation",
  "physics",
  "chemistry",
  "biology",
  "bioinformatics",
  "astronomy",
  "mathematics",
  "statistics",
  "quantum-computing",
  "signal-processing",
  "geospatial",
  "machine-learning",
  "deep-learning",
  "neural-network",
  "computer-vision",
  "nlp",
  "data-science",
  "data-visualization",
  "visualization",

  // Graphics, games and generative work
  "graphics",
  "opengl",
  "vulkan",
  "shaders",
  "ray-tracing",
  "rendering",
  "3d",
  "game-engine",
  "game-development",
  "godot",
  "chess",
  "pixel-art",
  "ascii-art",
  "generative-art",
  "creative-coding",
  "demoscene",
  "art",
  "music",
  "audio",
  "synthesizer",
  "midi",
  "music-production",
  "video",
  "image-processing",
  "photography",
  "animation",

  // Web, tooling and everyday software
  "devtools",
  "web-development",
  "react",
  "vue",
  "svelte",
  "nodejs",
  "api",
  "database",
  "sql",
  "storage",
  "testing",
  "automation",
  "productivity",
  "design-system",
  "package-manager",
  "build-tool",
  "documentation",
  "static-site-generator",
  "cms",
  "markdown",
  "notes",
  "note-taking",
  "knowledge-base",
  "rss",
  "search",
  "email",
  "chat",
  "browser",
  "browser-extension",
  "mobile",
  "parser",
  "serialization",
];

/**
 * Rotating star bands for popularity-sorted searches. Without them every
 * search returns the same handful of mega-popular repositories, which is what
 * made the feed look like it only knew a few corners of GitHub.
 */
const STAR_BANDS = [
  "",
  " stars:25..500",
  " stars:500..5000",
  " stars:2000..20000",
];

/** Freshness-sorted searches stay above the noise floor of abandoned repos. */
const ACTIVE_STARS = " stars:>=25";

const FEED_WINDOW = 24;
const MAX_README_CHARS = 12_000;

/* ------------------------------------------------------------------ *
 * Shared helpers                                                      *
 * ------------------------------------------------------------------ */

/** The shape every project card is rendered from. */
function toProject(repo: Doc<"repos">, interaction: Doc<"ratings"> | null) {
  return {
    repoId: repo.repoId,
    fullName: repo.fullName,
    owner: repo.owner,
    name: repo.name,
    description: repo.description ?? null,
    url: repo.url,
    homepage: repo.homepage ?? null,
    stars: repo.stars,
    forks: repo.forks,
    openIssues: repo.openIssues,
    language: repo.language ?? null,
    license: repo.license ?? null,
    topics: repo.topics,
    pushedAt: repo.pushedAt ?? null,
    archived: repo.archived,
    firstSeenAt: repo.firstSeenAt,
    discoveredVia: repo.discoveredVia,
    // The README text is large, so it is fetched per card instead of being
    // shipped with every list. `readmeLoaded` says whether to bother.
    readmeLoaded: repo.readmeFetchedAt !== undefined,
    images: repo.images ?? [],
    rating: interaction?.value ?? null,
    saved: interaction?.saved === true,
    hidden: interaction?.hidden === true,
  };
}

async function interactionsForUser(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Map<number, Doc<"ratings">>> {
  const rows = await ctx.db
    .query("ratings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return new Map(rows.map((row) => [row.repoId, row]));
}

async function findRepo(
  ctx: QueryCtx,
  repoId: number,
): Promise<Doc<"repos"> | null> {
  return await ctx.db
    .query("repos")
    .withIndex("by_repo_id", (q) => q.eq("repoId", repoId))
    .unique();
}

function countBy(values: Iterable<string>, counts: Map<string, number>): void {
  for (const value of values) {
    if (!value) continue;
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
 * Deterministic per-user starting point in the topic pool. Without it every
 * account walks the same list from the same place and sees the same famous
 * projects first.
 */
function seededOffset(seed: string, length: number): number {
  if (length <= 1) return 0;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % length;
}

/**
 * How much a rated-highly project should push the feed toward its topics.
 * Capped: rating twenty projects that share a topic used to add twenty points
 * to it, which buried every other topic in the feed.
 */
function affinityWeight(count: number): number {
  return Math.min(count, 3);
}

/**
 * Ranking weights for the candidate window. Popularity is a tiebreaker here,
 * not the signal: at 0.5·log10(stars) a 100k-star repository outranked every
 * smaller one, so whole domains — keyboards, TUIs, simulations, art, music —
 * could never reach the window even once they were in the catalog.
 */
const STARS_WEIGHT = 0.35;
const STARS_CAP = 1.4;
const JITTER_WEIGHT = 1.2;

/** Never lose a project to a tie: the jitter is stable per project. */
function noveltyScore(
  repo: Doc<"repos">,
  topicAffinity: Map<string, number>,
  languageAffinity: Map<string, number>,
  now: number,
): number {
  if (repo.archived) return -100;

  let score = Math.min(Math.log10(repo.stars + 1) * STARS_WEIGHT, STARS_CAP);
  if (repo.pushedAt && now - repo.pushedAt < 120 * 24 * 60 * 60 * 1000) {
    score += 0.6;
  }
  for (const topic of repo.topics) {
    score += affinityWeight(topicAffinity.get(topic) ?? 0) * 0.4;
  }
  if (repo.language) {
    score += affinityWeight(languageAffinity.get(repo.language) ?? 0) * 0.6;
  }
  score += ((repo.repoId % 997) / 997) * JITTER_WEIGHT;
  return score;
}

/* ------------------------------------------------------------------ *
 * Topics (optional: they steer discovery, they do not define it)      *
 * ------------------------------------------------------------------ */

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

export const addTopic = mutation({
  args: { topic: v.string() },
  handler: async (ctx, { topic }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to follow topics.");
    const slug = normalizeTopic(topic);
    if (!slug) throw new Error('Enter a topic like "rust" or "devtools".');

    const existing = await ctx.db
      .query("topics")
      .withIndex("by_user_slug", (q) => q.eq("userId", userId).eq("slug", slug))
      .unique();
    if (existing) return { slug, created: false };

    await ctx.db.insert("topics", { userId, slug, createdAt: Date.now() });
    return { slug, created: true };
  },
});

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

/* ------------------------------------------------------------------ *
 * The discovery feed                                                  *
 * ------------------------------------------------------------------ */

/**
 * The next window of the feed: projects the user has never been shown, ranked
 * by a mix of popularity, freshness and what they have rated highly before.
 * Nothing here is limited to the user's topics — those only add weight.
 */
export const discovery = query({
  args: { excludeRepoIds: v.optional(v.array(v.number())), limit: v.optional(v.number()) },
  handler: async (ctx, { excludeRepoIds, limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const rows = await ctx.db
      .query("ratings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const touched = new Set(rows.map((row) => row.repoId));
    const loved = new Set(
      rows.filter((row) => (row.value ?? 0) >= 4).map((row) => row.repoId),
    );

    const repos = await ctx.db.query("repos").collect();
    const candidates = repos.filter((repo) => !touched.has(repo.repoId));
    const unseenCandidates = excludeRepoIds?.length
      ? candidates.filter((repo) => !excludeRepoIds.includes(repo.repoId))
      : candidates;

    const topicAffinity = new Map<string, number>();
    const languageAffinity = new Map<string, number>();
    for (const repo of repos) {
      if (!loved.has(repo.repoId)) continue;
      countBy(repo.topics, topicAffinity);
      if (repo.language) countBy([repo.language], languageAffinity);
    }

    const now = Date.now();
    const window = unseenCandidates
      .map((repo) => ({
        repoId: repo.repoId,
        score: noveltyScore(repo, topicAffinity, languageAffinity, now),
      }))
      .sort((a, b) => b.score - a.score || a.repoId - b.repoId)
      .slice(0, Math.max(1, Math.min(limit ?? FEED_WINDOW, FEED_WINDOW)));

    return {
      repoIds: window.map((entry) => entry.repoId),
      remaining: candidates.length,
      catalogSize: repos.length,
      rated: rows.filter((row) => typeof row.value === "number").length,
    };
  },
});

/** Full card data for the projects the client is holding, freshest first. */
export const projects = query({
  args: { repoIds: v.array(v.number()) },
  handler: async (ctx, { repoIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // The client holds a rolling window of cards; this matches its cap.
    const unique = [...new Set(repoIds)].slice(0, 160);
    const interactions = await interactionsForUser(ctx, userId);

    const items = await Promise.all(
      unique.map(async (repoId) => {
        const repo = await findRepo(ctx, repoId);
        return repo
          ? toProject(repo, interactions.get(repoId) ?? null)
          : null;
      }),
    );

    return { items: items.filter((item) => item !== null) };
  },
});

/**
 * The README for one project, fetched only by cards near the viewport. This
 * keeps the feed payload small no matter how far the user has scrolled.
 */
export const readme = query({
  args: { repoId: v.number() },
  handler: async (ctx, { repoId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const repo = await findRepo(ctx, repoId);
    if (!repo) return null;
    return {
      readme: repo.readme ?? null,
      readmeLoaded: repo.readmeFetchedAt !== undefined,
      images: repo.images ?? [],
    };
  },
});

/** Saved, rated and hidden projects — the user's own library. */
export const library = query({
  args: {
    kind: v.union(
      v.literal("saved"),
      v.literal("rated"),
      v.literal("hidden"),
    ),
  },
  handler: async (ctx, { kind }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const rows = await ctx.db
      .query("ratings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const selected = rows
      .filter((row) =>
        kind === "saved"
          ? row.saved === true
          : kind === "hidden"
            ? row.hidden === true
            : typeof row.value === "number",
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const items = await Promise.all(
      selected.map(async (row) => {
        const repo = await findRepo(ctx, row.repoId);
        return repo ? toProject(repo, row) : null;
      }),
    );

    return {
      items: items.filter((item) => item !== null),
      total: selected.length,
    };
  },
});

/** Everything the dashboard shows at a glance. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const topics = await ctx.db
      .query("topics")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const rows = await ctx.db
      .query("ratings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const repos = await ctx.db.query("repos").collect();

    const rated = rows.filter((row) => typeof row.value === "number");
    const averageInterest =
      rated.length > 0
        ? rated.reduce((sum, row) => sum + (row.value ?? 0), 0) / rated.length
        : null;

    const counts: Record<string, number> = {};
    for (const topic of topics) counts[topic.slug] = 0;
    for (const repo of repos) {
      for (const slug of repo.discoveredVia) {
        if (slug in counts) counts[slug] += 1;
      }
    }

    const touched = new Set(rows.map((row) => row.repoId));

    return {
      catalogSize: repos.length,
      unseen: repos.filter((repo) => !touched.has(repo.repoId)).length,
      rated: rated.length,
      saved: rows.filter((row) => row.saved === true).length,
      hidden: rows.filter((row) => row.hidden === true).length,
      averageInterest,
      counts,
    };
  },
});

/**
 * The catalog: every project fetched so far, hidden ones aside, so old
 * discoveries stay browsable and searchable.
 */
export const catalog = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const interactions = await interactionsForUser(ctx, userId);
    const repos = (await ctx.db.query("repos").collect()).filter(
      (repo) => interactions.get(repo.repoId)?.hidden !== true,
    );

    const languageCounts = new Map<string, number>();
    const topicCounts = new Map<string, number>();
    for (const repo of repos) {
      if (repo.language) countBy([repo.language], languageCounts);
      countBy(repo.topics, topicCounts);
    }

    return {
      items: repos.map((repo) =>
        toProject(repo, interactions.get(repo.repoId) ?? null),
      ),
      total: repos.length,
      rated: repos.filter(
        (repo) => typeof interactions.get(repo.repoId)?.value === "number",
      ).length,
      languages: facets(languageCounts, 8),
      topics: facets(topicCounts, 14),
    };
  },
});

/* ------------------------------------------------------------------ *
 * Interactions                                                        *
 * ------------------------------------------------------------------ */

async function upsertInteraction(
  ctx: MutationCtx,
  userId: Id<"users">,
  repoId: number,
  patch: {
    value?: number;
    saved?: boolean;
    hidden?: boolean;
    seenAt?: number;
  },
): Promise<void> {
  const now = Date.now();
  const existing = await ctx.db
    .query("ratings")
    .withIndex("by_user_repo", (q) =>
      q.eq("userId", userId).eq("repoId", repoId),
    )
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, { ...patch, updatedAt: now });
    return;
  }
  await ctx.db.insert("ratings", {
    userId,
    repoId,
    seenAt: now,
    createdAt: now,
    updatedAt: now,
    ...patch,
  });
}

/** How interested the user is in a project (1 = low, 5 = high). */
export const setRating = mutation({
  args: { repoId: v.number(), value: v.number() },
  handler: async (ctx, { repoId, value }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to rate projects.");
    const clamped = Math.max(1, Math.min(5, Math.round(value)));
    await upsertInteraction(ctx, userId, repoId, { value: clamped });
    return clamped;
  },
});

/** Remove a rating without forgetting that the project has been seen. */
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
    if (existing) {
      await ctx.db.patch(existing._id, {
        value: undefined,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Keep a project for later. */
export const setSaved = mutation({
  args: { repoId: v.number(), saved: v.boolean() },
  handler: async (ctx, { repoId, saved }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to save projects.");
    await upsertInteraction(ctx, userId, repoId, { saved });
    return saved;
  },
});

/** Hide a project: out of the feed and the catalog, kept in the library. */
export const setHidden = mutation({
  args: { repoId: v.number(), hidden: v.boolean() },
  handler: async (ctx, { repoId, hidden }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to hide projects.");
    await upsertInteraction(ctx, userId, repoId, { hidden });
    return hidden;
  },
});

/** Mark the projects that have scrolled past, so the feed keeps moving. */
export const markSeen = mutation({
  args: { repoIds: v.array(v.number()) },
  handler: async (ctx, { repoIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const unique = [...new Set(repoIds)].slice(0, 60);
    for (const repoId of unique) {
      const existing = await ctx.db
        .query("ratings")
        .withIndex("by_user_repo", (q) =>
          q.eq("userId", userId).eq("repoId", repoId),
        )
        .unique();
      if (existing) continue;
      const now = Date.now();
      await ctx.db.insert("ratings", {
        userId,
        repoId,
        seenAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    return unique.length;
  },
});

/* ------------------------------------------------------------------ *
 * Internal functions used by the GitHub actions (actions have no db)  *
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

    for (const repo of repos) {
      const existing = await ctx.db
        .query("repos")
        .withIndex("by_repo_id", (q) => q.eq("repoId", repo.repoId))
        .unique();

      if (existing) {
        const discoveredVia = existing.discoveredVia.includes(topicSlug)
          ? existing.discoveredVia
          : [...existing.discoveredVia, topicSlug];
        await ctx.db.patch(existing._id, {
          ...repo,
          discoveredVia,
          updatedAt: now,
        });
      } else {
        added += 1;
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

    return { added, refreshed: repos.length };
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

/**
 * Decide what to search next: the user's own topics first, then the topics of
 * projects they rated highly, then a broad pool so discovery never stalls.
 * Advances the user's cursor so repeat fetches keep returning new projects.
 */
export const planSearches = internalMutation({
  args: { userId: v.id("users"), count: v.number() },
  handler: async (ctx, { userId, count }) => {
    const topics = await ctx.db
      .query("topics")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const rows = await ctx.db
      .query("ratings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const learned = new Map<string, number>();
    for (const row of rows) {
      if ((row.value ?? 0) < 4) continue;
      const repo = await ctx.db
        .query("repos")
        .withIndex("by_repo_id", (q) => q.eq("repoId", row.repoId))
        .unique();
      if (!repo) continue;
      countBy(repo.topics, learned);
      if (repo.language) countBy([normalizeTopic(repo.language)], learned);
    }

    const pool = [
      ...new Set([
        ...topics.map((topic) => topic.slug),
        ...facets(learned, 6).map((entry) => entry.name),
        ...DEFAULT_TOPICS,
      ]),
    ].filter(Boolean);

    const state = await ctx.db
      .query("feedState")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const step = state?.step ?? 0;

    const requested = Math.max(1, Math.min(count, 4));
    const start = seededOffset(userId, pool.length);
    const specs = Array.from({ length: requested }, (_, offset) => {
      const index = step + offset;
      // Alternate the ordering so the feed is not just the famous few.
      const sort = index % 2 === 0 ? ("stars" as const) : ("updated" as const);
      return {
        topic: pool[(start + index) % pool.length],
        sort,
        // Popularity-sorted searches rotate through star bands so smaller
        // keyboard/TUI/art/music projects are reachable at all.
        stars:
          sort === "updated"
            ? ACTIVE_STARS
            : STAR_BANDS[Math.floor(index / 2) % STAR_BANDS.length],
        page: Math.floor(index / pool.length) + 1,
      };
    });

    const now = Date.now();
    if (state) {
      await ctx.db.patch(state._id, { step: step + requested, updatedAt: now });
    } else {
      await ctx.db.insert("feedState", { userId, step: requested, updatedAt: now });
    }

    return { specs };
  },
});

/** Repositories still missing their README, limited to what was asked for. */
export const projectsToEnrich = internalQuery({
  args: { repoIds: v.array(v.number()) },
  handler: async (ctx, { repoIds }) => {
    const unique = [...new Set(repoIds)].slice(0, 8);
    const repos = await Promise.all(
      unique.map((repoId) =>
        ctx.db
          .query("repos")
          .withIndex("by_repo_id", (q) => q.eq("repoId", repoId))
          .unique(),
      ),
    );
    return repos
      .filter((repo) => repo !== null)
      .filter((repo) => repo.readmeFetchedAt === undefined)
      .map((repo) => ({ repoId: repo.repoId, fullName: repo.fullName }));
  },
});

export const saveEnrichment = internalMutation({
  args: {
    entries: v.array(
      v.object({
        repoId: v.number(),
        readme: v.union(v.string(), v.null()),
        images: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, { entries }) => {
    const now = Date.now();
    for (const entry of entries) {
      const repo = await ctx.db
        .query("repos")
        .withIndex("by_repo_id", (q) => q.eq("repoId", entry.repoId))
        .unique();
      if (!repo) continue;
      await ctx.db.patch(repo._id, {
        readme: entry.readme
          ? entry.readme.slice(0, MAX_README_CHARS)
          : undefined,
        images: entry.images,
        readmeFetchedAt: now,
        updatedAt: now,
      });
    }
    return entries.length;
  },
});
