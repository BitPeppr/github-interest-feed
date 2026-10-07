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

const MAX_README_CHARS = 12_000;
/** Star growth is always reported as a true seven-day rate. */
const GROWTH_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;
/** Snapshot writes are chunked by callers; this caps a single mutation too. */
const SNAPSHOT_BATCH_CAP = 100;
/** Star history keeps enough runway for growth diffs — not forever. */
const HISTORY_RETENTION_DAYS = 90;
const PRUNE_BATCH = 500;
/** How many searches the planner remembers in order to avoid re-running them. */
const RECENT_SEARCHES = 24;

/* ------------------------------------------------------------------ *
 * Shared helpers                                                      *
 * ------------------------------------------------------------------ */

/** The shape every project card is rendered from. */
export function toProject(
  repo: Doc<"repos">,
  interaction: Doc<"ratings"> | null,
  reasons: string[] = [],
) {
  return {
    repoId: repo.repoId,
    fullName: repo.fullName,
    owner: repo.owner,
    name: repo.name,
    description: repo.description ?? null,
    url: repo.url,
    homepage: repo.homepage ?? null,
    stars: repo.stars,
    starGrowth7d: repo.starGrowth7d ?? null,
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
    // "Why am I seeing this" — populated for recommendations, empty for the
    // library (saved/hidden lists are not recommendations).
    reasons,
  };
}

export async function interactionsForUser(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Map<number, Doc<"ratings">>> {
  const rows = await ctx.db
    .query("ratings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return new Map(rows.map((row) => [row.repoId, row]));
}

export async function findRepo(
  ctx: QueryCtx,
  repoId: number,
): Promise<Doc<"repos"> | null> {
  return await ctx.db
    .query("repos")
    .withIndex("by_repo_id", (q) => q.eq("repoId", repoId))
    .unique();
}

/** Topics the user explicitly follows (bounded: users follow a handful). */
async function followedTopicsFor(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Set<string>> {
  const topics = await ctx.db
    .query("topics")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return new Set(topics.map((topic) => topic.slug));
}

/**
 * Full user signals for ranking/explanations. Reads the user's own rating
 * rows (bounded per user) plus one indexed repo lookup per rated repo.
 * NOTE (perf): PR4 serves the feed from a persisted queue and stops
 * rebuilding this on the hot path; the queue generator keeps this cost in
 * the background.
 */
async function signalsForUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  now: number,
): Promise<ReturnType<typeof buildSignals>> {
  const rows = await ctx.db
    .query("ratings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const rated = [];
  for (const row of rows) {
    const repo = await ctx.db
      .query("repos")
      .withIndex("by_repo_id", (q) => q.eq("repoId", row.repoId))
      .unique();
    if (!repo) continue;
    rated.push({
      repo: toSnapshot(repo),
      value: row.value,
      saved: row.saved,
      hidden: row.hidden,
      githubOpens: row.githubOpens,
      readmeOpens: row.readmeOpens,
      dwellMs: row.dwellMs,
    });
  }
  return buildSignals(now, rated);
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
 * Ranking lives in `recommender/`: `signals.ts` builds user signals,
 * `scoring.ts` extracts features and scores, `candidates.ts` assembles the
 * window with exploration on an independent path, `rerank.ts` diversifies.
 * This module keeps Convex access (queries, mutations) and thin adapters.
 */
import { assembleFeed, tagSources } from "./recommender/candidates";
import type { RepoSnapshot } from "./recommender/types";
import { buildSignals } from "./recommender/signals";
import { explainCandidate } from "./recommender/explain";
import { scoreProject } from "./recommender/scoring";
import {
  applyImpressions,
  applyTransition,
  emptyProfile,
  fromStorable,
  toStorable,
  type ProfileSnapshot,
  type RowState,
} from "./recommender/profile";

/** Convert a `repos` document to the ranking boundary shape. */
export function toSnapshot(repo: Doc<"repos">): RepoSnapshot {
  return {
    repoId: repo.repoId,
    fullName: repo.fullName,
    owner: repo.owner,
    name: repo.name,
    description: repo.description,
    stars: repo.stars,
    forks: repo.forks,
    openIssues: repo.openIssues,
    language: repo.language,
    topics: repo.topics,
    pushedAt: repo.pushedAt,
    archived: repo.archived,
    discoveredVia: repo.discoveredVia,
    starGrowth7d: repo.starGrowth7d,
    starAccel: repo.starAccel,
  };
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
  args: {
    excludeRepoIds: v.optional(v.array(v.number())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { excludeRepoIds, limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const rows = await ctx.db
      .query("ratings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const touched = new Set(rows.map((row) => row.repoId));
    const repos = await ctx.db.query("repos").collect();
    const byId = new Map(repos.map((repo) => [repo.repoId, repo]));

    // Every rating row pairs with its repository for signal building; rows
    // whose repo left the catalog still count as touched (never re-served).
    const rated = rows.flatMap((row) => {
      const repo = byId.get(row.repoId);
      return repo
        ? [
            {
              repo: toSnapshot(repo),
              value: row.value,
              saved: row.saved,
              hidden: row.hidden,
              githubOpens: row.githubOpens,
              readmeOpens: row.readmeOpens,
              dwellMs: row.dwellMs,
            },
          ]
        : [];
    });
    const signals = buildSignals(Date.now(), rated);
    const followed = await followedTopicsFor(ctx, userId);

    const excluded = new Set(excludeRepoIds ?? []);
    // NOTE (perf): the whole-catalog scan is preserved in this refactor PR so
    // behaviour stays comparable. PR4 replaces it with a persisted per-user
    // feed queue and bounded reads.
    const { window, unseenCount } = assembleFeed(
      repos.map(toSnapshot),
      signals,
      touched,
      excluded,
      { limit, followedTopics: followed },
    );

    return {
      repoIds: window.map((entry) => entry.repo.repoId),
      remaining: Math.max(0, unseenCount - window.length),
      catalogSize: repos.length,
      rated: rows.filter(
        (row) => typeof row.value === "number" && row.implicit !== true,
      ).length,
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
    // Explanations reuse the same signals the ranker used. Rebuilt here from
    // the user's own rows (bounded per user); the persisted queue (PR4) will
    // carry reasons with each card instead.
    const signals = await signalsForUser(ctx, userId, Date.now());
    const followed = await followedTopicsFor(ctx, userId);

    // One scan feeds every card — no per-id lookups.
    const byId = new Map(
      (await ctx.db.query("repos").collect()).map((repo) => [
        repo.repoId,
        repo,
      ]),
    );

    const items = unique.flatMap((repoId) => {
      const repo = byId.get(repoId);
      if (!repo) return [];
      const snapshot = toSnapshot(repo);
      const { features } = scoreProject(snapshot, signals, undefined, {
        followedTopics: followed,
      });
      const sources = tagSources(snapshot, signals, followed);
      const reasons = explainCandidate({
        candidate: {
          repo: snapshot,
          score: 0,
          explore: 0,
          facets: new Set<string>(),
          sources,
          features,
          parts: [],
        },
        signals,
        followedTopics: followed,
      });
      return [toProject(repo, interactions.get(repoId) ?? null, reasons)];
    });

    return { items };
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
    // README text lives in its own table; the fallback covers rows that have
    // not been migrated yet.
    const record = await ctx.db
      .query("repoReadmes")
      .withIndex("by_repo_id", (q) => q.eq("repoId", repoId))
      .unique();
    return {
      readme: record?.readme ?? repo.readme ?? null,
      readmeLoaded: repo.readmeFetchedAt !== undefined,
      images: repo.images ?? [],
    };
  },
});

/** Saved, rated and hidden projects — the user's own library. */
export const library = query({
  args: {
    kind: v.union(v.literal("saved"), v.literal("rated"), v.literal("hidden")),
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

    // One scan feeds every row — no per-id lookups.
    const repos = new Map(
      (await ctx.db.query("repos").collect()).map((repo) => [
        repo.repoId,
        repo,
      ]),
    );

    const items = selected.flatMap((row) => {
      const repo = repos.get(row.repoId);
      return repo ? [toProject(repo, row)] : [];
    });

    return {
      items,
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

    const rated = rows.filter(
      (row) => typeof row.value === "number" && row.implicit !== true,
    );
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
 *                                                                     *
 * Every mutation below does three things: persist current state in     *
 * `ratings`, append history to `interactionEvents`, and fold the delta *
 * into the incremental `userRecProfiles` document.                   *
 * ------------------------------------------------------------------ */

/** Event kinds the client may report directly (state changes log their own). */
export const trackableEventValidator = v.union(
  v.literal("readme_opened"),
  v.literal("github_opened"),
  v.literal("homepage_opened"),
  v.literal("dwell"),
  v.literal("previous"),
  v.literal("next"),
);

/** Dwell reports outside this window are ignored (background-tab noise). */
const MIN_DWELL_MS = 1_000;
const MAX_DWELL_MS = 600_000;
const MAX_TOTAL_DWELL_MS = 3_600_000;

function toRowState(
  row: {
    value?: number;
    saved?: boolean;
    hidden?: boolean;
    githubOpens?: number;
    readmeOpens?: number;
  } | null,
): RowState {
  if (!row) return {};
  return {
    value: row.value,
    saved: row.saved,
    hidden: row.hidden,
    githubOpens: row.githubOpens,
    readmeOpens: row.readmeOpens,
  };
}

async function loadRatingRow(
  ctx: MutationCtx,
  userId: Id<"users">,
  repoId: number,
) {
  return await ctx.db
    .query("ratings")
    .withIndex("by_user_repo", (q) =>
      q.eq("userId", userId).eq("repoId", repoId),
    )
    .unique();
}

/** Facets for profile math; missing repos contribute counts but no facets. */
async function facetsForRepo(ctx: MutationCtx, repoId: number) {
  const repo = await ctx.db
    .query("repos")
    .withIndex("by_repo_id", (q) => q.eq("repoId", repoId))
    .unique();
  return {
    topics: repo?.topics ?? [],
    language: repo?.language,
    owner: repo?.owner ?? "",
  };
}

async function appendEvent(
  ctx: MutationCtx,
  userId: Id<"users">,
  repoId: number,
  kind:
    | "impression"
    | "rating"
    | "rating_removed"
    | "saved"
    | "unsaved"
    | "hidden"
    | "unhidden"
    | "readme_opened"
    | "github_opened"
    | "homepage_opened"
    | "dwell"
    | "previous"
    | "next",
  value?: number,
): Promise<void> {
  await ctx.db.insert("interactionEvents", {
    userId,
    repoId,
    kind,
    value,
    createdAt: Date.now(),
  });
}

async function loadProfile(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<{ docId: Id<"userRecProfiles"> | null; profile: ProfileSnapshot }> {
  const doc = await ctx.db
    .query("userRecProfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!doc) return { docId: null, profile: emptyProfile() };
  return {
    docId: doc._id,
    profile: {
      ratingCount: doc.ratingCount,
      impressionCount: doc.impressionCount,
      positiveCount: doc.positiveCount,
      negativeCount: doc.negativeCount,
      savedCount: doc.savedCount,
      hiddenCount: doc.hiddenCount,
      githubOpenCount: doc.githubOpenCount,
      readmeOpenCount: doc.readmeOpenCount,
      ...fromStorable(doc),
      feedVersion: doc.feedVersion,
    },
  };
}

async function storeProfile(
  ctx: MutationCtx,
  userId: Id<"users">,
  docId: Id<"userRecProfiles"> | null,
  profile: ProfileSnapshot,
): Promise<void> {
  const now = Date.now();
  const storable = toStorable(profile);
  if (!docId) {
    await ctx.db.insert("userRecProfiles", {
      userId,
      ratingCount: profile.ratingCount,
      impressionCount: profile.impressionCount,
      positiveCount: profile.positiveCount,
      negativeCount: profile.negativeCount,
      savedCount: profile.savedCount,
      hiddenCount: profile.hiddenCount,
      githubOpenCount: profile.githubOpenCount,
      readmeOpenCount: profile.readmeOpenCount,
      ...storable,
      feedVersion: profile.feedVersion,
      updatedAt: now,
    });
    return;
  }
  await ctx.db.patch(docId, {
    ratingCount: profile.ratingCount,
    impressionCount: profile.impressionCount,
    positiveCount: profile.positiveCount,
    negativeCount: profile.negativeCount,
    savedCount: profile.savedCount,
    hiddenCount: profile.hiddenCount,
    githubOpenCount: profile.githubOpenCount,
    readmeOpenCount: profile.readmeOpenCount,
    ...storable,
    feedVersion: profile.feedVersion,
    updatedAt: now,
  });
}

/**
 * Fold one row transition into the incremental profile. Loads, updates and
 * stores the single per-user profile document.
 */
async function trackProfileTransition(
  ctx: MutationCtx,
  userId: Id<"users">,
  prev: RowState | null,
  next: RowState,
  repoId: number,
  created: boolean,
): Promise<void> {
  const { docId, profile } = await loadProfile(ctx, userId);
  applyTransition(
    profile,
    prev,
    next,
    await facetsForRepo(ctx, repoId),
    created,
  );
  await storeProfile(ctx, userId, docId, profile);
}

async function upsertInteraction(
  ctx: MutationCtx,
  userId: Id<"users">,
  repoId: number,
  patch: {
    value?: number;
    implicit?: boolean;
    saved?: boolean;
    hidden?: boolean;
    seenAt?: number;
  },
): Promise<void> {
  const now = Date.now();
  const existing = await loadRatingRow(ctx, userId, repoId);

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
    const existing = await loadRatingRow(ctx, userId, repoId);
    const prev = toRowState(existing);
    // A deliberate rating replaces an imported one: clear the implicit flag so
    // the rating counts in stats and Wrapped.
    await upsertInteraction(ctx, userId, repoId, {
      value: clamped,
      implicit: undefined,
    });
    await appendEvent(ctx, userId, repoId, "rating", clamped);
    await trackProfileTransition(
      ctx,
      userId,
      prev,
      { ...prev, value: clamped },
      repoId,
      !existing,
    );
    return clamped;
  },
});

/** Remove a rating without forgetting that the project has been seen. */
export const clearRating = mutation({
  args: { repoId: v.number() },
  handler: async (ctx, { repoId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to rate projects.");
    const existing = await loadRatingRow(ctx, userId, repoId);
    if (existing) {
      const prev = toRowState(existing);
      await ctx.db.patch(existing._id, {
        value: undefined,
        // A deliberate clear ends the row's life as imported taste too:
        // explicit actions always beat an imported profile.
        implicit: undefined,
        updatedAt: Date.now(),
      });
      await appendEvent(ctx, userId, repoId, "rating_removed");
      await trackProfileTransition(
        ctx,
        userId,
        prev,
        { ...prev, value: undefined },
        repoId,
        false,
      );
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
    const existing = await loadRatingRow(ctx, userId, repoId);
    const prev = toRowState(existing);
    await upsertInteraction(ctx, userId, repoId, { saved });
    await appendEvent(ctx, userId, repoId, saved ? "saved" : "unsaved");
    await trackProfileTransition(
      ctx,
      userId,
      prev,
      { ...prev, saved },
      repoId,
      !existing,
    );
    return saved;
  },
});

/** Hide a project: out of the feed and the catalog, kept in the library. */
export const setHidden = mutation({
  args: { repoId: v.number(), hidden: v.boolean() },
  handler: async (ctx, { repoId, hidden }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to hide projects.");
    const existing = await loadRatingRow(ctx, userId, repoId);
    const prev = toRowState(existing);
    await upsertInteraction(ctx, userId, repoId, { hidden });
    await appendEvent(ctx, userId, repoId, hidden ? "hidden" : "unhidden");
    await trackProfileTransition(
      ctx,
      userId,
      prev,
      { ...prev, hidden },
      repoId,
      !existing,
    );
    return hidden;
  },
});

/**
 * Client-reported engagement: README/GitHub opens, aggregated dwell, and
 * navigation. Opens bump bounded per-row counters (ranking input); dwell is
 * stored for evaluation but excluded from affinity.
 */
export const trackEvent = mutation({
  args: {
    repoId: v.number(),
    kind: trackableEventValidator,
    value: v.optional(v.number()),
  },
  handler: async (ctx, { repoId, kind, value }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to interact with projects.");
    const existing = await loadRatingRow(ctx, userId, repoId);
    const prev = toRowState(existing);
    const now = Date.now();

    if (kind === "dwell") {
      const ms = Math.round(value ?? 0);
      if (!Number.isFinite(ms) || ms < MIN_DWELL_MS || ms > MAX_DWELL_MS) {
        return null;
      }
      const total = Math.min((existing?.dwellMs ?? 0) + ms, MAX_TOTAL_DWELL_MS);
      if (existing) {
        await ctx.db.patch(existing._id, { dwellMs: total, updatedAt: now });
      } else {
        await ctx.db.insert("ratings", {
          userId,
          repoId,
          seenAt: now,
          createdAt: now,
          updatedAt: now,
          dwellMs: total,
        });
      }
      await appendEvent(ctx, userId, repoId, "dwell", ms);
      if (!existing) {
        // A dwell-only row is still an impression for the profile.
        const { docId, profile } = await loadProfile(ctx, userId);
        applyImpressions(profile, 1);
        await storeProfile(ctx, userId, docId, profile);
      }
      return total;
    }

    if (kind === "github_opened" || kind === "readme_opened") {
      const field = kind === "github_opened" ? "githubOpens" : "readmeOpens";
      const nextCount = (existing?.[field] ?? 0) + 1;
      const patch =
        field === "githubOpens"
          ? { githubOpens: nextCount }
          : { readmeOpens: nextCount };
      if (existing) {
        await ctx.db.patch(existing._id, { ...patch, updatedAt: now });
      } else {
        await ctx.db.insert("ratings", {
          userId,
          repoId,
          seenAt: now,
          createdAt: now,
          updatedAt: now,
          ...patch,
        });
      }
      await appendEvent(ctx, userId, repoId, kind);
      await trackProfileTransition(
        ctx,
        userId,
        prev,
        { ...prev, [field]: nextCount },
        repoId,
        !existing,
      );
      return nextCount;
    }

    // homepage_opened / previous / next: history only, no state change.
    await appendEvent(ctx, userId, repoId, kind, value);
    return null;
  },
});

/** Mark the projects that have scrolled past, so the feed keeps moving. */
export const markSeen = mutation({
  args: { repoIds: v.array(v.number()) },
  handler: async (ctx, { repoIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const unique = [...new Set(repoIds)].slice(0, 60);
    let created = 0;
    for (const repoId of unique) {
      const existing = await loadRatingRow(ctx, userId, repoId);
      if (existing) continue;
      const now = Date.now();
      await ctx.db.insert("ratings", {
        userId,
        repoId,
        seenAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await appendEvent(ctx, userId, repoId, "impression");
      created += 1;
    }
    if (created > 0) {
      // One profile write for the whole batch, not one per row.
      const { docId, profile } = await loadProfile(ctx, userId);
      applyImpressions(profile, created);
      await storeProfile(ctx, userId, docId, profile);
    }
    return unique.length;
  },
});

/* ------------------------------------------------------------------ *
 * Internal functions used by the GitHub actions (actions have no db)  *
 * ------------------------------------------------------------------ */

function dayString(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Whole days between two "YYYY-MM-DD" (UTC) day keys. */
function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/**
 * Record today's star counts and diff them against a true seven-day window, so
 * every repo carries its own growth and acceleration for ranking and "rising"
 * labels. The anchor is the snapshot closest to seven days ago and the diff is
 * normalised to a 7-day rate, so a missed day (or a late cron) cannot quietly
 * turn "growth this week" into growth over nine days. Growth without history
 * is simply absent — no guesses.
 */
export const recordStarSnapshots = internalMutation({
  args: {
    entries: v.array(v.object({ repoId: v.number(), stars: v.number() })),
  },
  handler: async (ctx, { entries }) => {
    const now = Date.now();
    const today = dayString(now);
    const anchorDay = dayString(now - GROWTH_WINDOW_DAYS * DAY_MS);
    let processed = 0;

    for (const entry of entries.slice(0, SNAPSHOT_BATCH_CAP)) {
      processed += 1;
      const existing = await ctx.db
        .query("starHistory")
        .withIndex("by_repo_day", (q) =>
          q.eq("repoId", entry.repoId).eq("day", today),
        )
        .unique();
      if (existing) {
        if (existing.stars !== entry.stars) {
          await ctx.db.patch(existing._id, { stars: entry.stars });
        }
      } else {
        await ctx.db.insert("starHistory", {
          repoId: entry.repoId,
          day: today,
          stars: entry.stars,
        });
      }

      // The closest snapshot at or before the seven-day mark.
      const past = await ctx.db
        .query("starHistory")
        .withIndex("by_repo_day", (q) =>
          q.eq("repoId", entry.repoId).lte("day", anchorDay),
        )
        .order("desc")
        .first();
      if (!past) continue;

      const span = dayDiff(past.day, today);
      if (span < 1) continue;
      // Normalise to a 7-day rate however sparse the history is.
      const growth = Math.round(
        ((entry.stars - past.stars) * GROWTH_WINDOW_DAYS) / span,
      );
      const earlier = await ctx.db
        .query("starHistory")
        .withIndex("by_repo_day", (q) =>
          q.eq("repoId", entry.repoId).lt("day", past.day),
        )
        .order("desc")
        .first();
      // Acceleration is only known when there is a previous window to diff
      // against — otherwise it stays absent rather than guessing.
      let accel: number | undefined;
      if (earlier) {
        const previousSpan = dayDiff(earlier.day, past.day);
        if (previousSpan >= 1) {
          const previousGrowth = Math.round(
            ((past.stars - earlier.stars) * GROWTH_WINDOW_DAYS) / previousSpan,
          );
          accel = growth - previousGrowth;
        }
      }

      const repo = await ctx.db
        .query("repos")
        .withIndex("by_repo_id", (q) => q.eq("repoId", entry.repoId))
        .unique();
      if (repo) {
        await ctx.db.patch(repo._id, {
          starGrowth7d: growth,
          starAccel: accel,
        });
      }
    }
    return processed;
  },
});

/** Fastest movers and newest arrivals first — where growth is most likely. */
export const reposToRefresh = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const repos = await ctx.db.query("repos").collect();
    const movers = [...repos]
      .sort((a, b) => b.stars - a.stars)
      .slice(0, Math.ceil(limit / 2));
    const fresh = [...repos]
      .sort((a, b) => b.firstSeenAt - a.firstSeenAt)
      .slice(0, Math.floor(limit / 2));
    const seen = new Set<number>();
    const out: { repoId: number; fullName: string }[] = [];
    for (const repo of [...movers, ...fresh]) {
      if (seen.has(repo.repoId)) continue;
      seen.add(repo.repoId);
      out.push({ repoId: repo.repoId, fullName: repo.fullName });
    }
    return out;
  },
});

/** Backfill a taste profile: starred projects become implicit 4/5 ratings. */
export const applyStarImport = internalMutation({
  args: { userId: v.id("users"), repoIds: v.array(v.number()) },
  handler: async (ctx, { userId, repoIds }) => {
    const now = Date.now();
    let imported = 0;
    let skipped = 0;
    // Callers chunk; the cap keeps one mutation bounded however it is called.
    for (const repoId of [...new Set(repoIds)].slice(0, 100)) {
      const existing = await ctx.db
        .query("ratings")
        .withIndex("by_user_repo", (q) =>
          q.eq("userId", userId).eq("repoId", repoId),
        )
        .unique();
      if (existing) {
        // Explicit beats imported: never overwrite what the user did.
        skipped += 1;
        continue;
      }
      await ctx.db.insert("ratings", {
        userId,
        repoId,
        value: 4,
        implicit: true,
        seenAt: now,
        createdAt: now,
        updatedAt: now,
      });
      imported += 1;
    }
    return { imported, skipped };
  },
});

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
    // Recently searched topic/sort combinations go to the back of the line, so
    // consecutive fetches keep turning the pool over instead of re-running the
    // same searches the moment the cursor laps them.
    const recentList = state?.recent ?? [];
    const recentSet = new Set(recentList);
    const candidates = Array.from({ length: requested * 4 }, (_, offset) => {
      const index = step + offset;
      // Alternate the ordering so the feed is not just the famous few.
      const sort = index % 2 === 0 ? ("stars" as const) : ("updated" as const);
      const topic = pool[(start + index) % pool.length];
      return {
        key: `${topic}|${sort}`,
        offset,
        spec: {
          topic,
          sort,
          // Popularity-sorted searches rotate through star bands so smaller
          // keyboard/TUI/art/music projects are reachable at all.
          stars:
            sort === "updated"
              ? ACTIVE_STARS
              : STAR_BANDS[Math.floor(index / 2) % STAR_BANDS.length],
          page: Math.floor(index / pool.length) + 1,
        },
      };
    });
    const fresh = candidates.filter((entry) => !recentSet.has(entry.key));
    // If everything in reach is too recent, the most recent are still better
    // than returning nothing.
    const chosen = [
      ...fresh,
      ...candidates.filter((entry) => recentSet.has(entry.key)),
    ].slice(0, requested);
    const specs = chosen.map((entry) => entry.spec);
    // The cursor also walks past candidates that were skipped for being too
    // recent, so they are not reconsidered on the very next fetch.
    const consumed = Math.max(...chosen.map((entry) => entry.offset)) + 1;
    const chosenKeys = new Set(chosen.map((entry) => entry.key));
    const recent = [
      ...recentList.filter((key) => !chosenKeys.has(key)),
      ...chosen.map((entry) => entry.key),
    ].slice(-RECENT_SEARCHES);

    const now = Date.now();
    if (state) {
      await ctx.db.patch(state._id, {
        step: step + consumed,
        recent,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("feedState", {
        userId,
        step: consumed,
        recent,
        updatedAt: now,
      });
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
        images: entry.images,
        readmeFetchedAt: now,
        updatedAt: now,
      });
      // The README text itself goes beside the repo doc, keeping the repos
      // table small enough to scan freely.
      const record = await ctx.db
        .query("repoReadmes")
        .withIndex("by_repo_id", (q) => q.eq("repoId", entry.repoId))
        .unique();
      const text = entry.readme
        ? entry.readme.slice(0, MAX_README_CHARS)
        : undefined;
      if (record) {
        await ctx.db.patch(record._id, { readme: text });
      } else {
        await ctx.db.insert("repoReadmes", {
          repoId: entry.repoId,
          readme: text,
        });
      }
    }
    return entries.length;
  },
});

/** One-off: shift legacy README text off the repos table. Idempotent. */
export const migrateReadmes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const repos = await ctx.db.query("repos").collect();
    let moved = 0;
    for (const repo of repos) {
      if (repo.readme === undefined) continue;
      const existing = await ctx.db
        .query("repoReadmes")
        .withIndex("by_repo_id", (q) => q.eq("repoId", repo.repoId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { readme: repo.readme });
      } else {
        await ctx.db.insert("repoReadmes", {
          repoId: repo.repoId,
          readme: repo.readme,
        });
      }
      await ctx.db.patch(repo._id, { readme: undefined });
      moved += 1;
    }
    return { moved };
  },
});

/**
 * Daily hygiene: growth diffs only need a few weeks of star history, so old
 * rows are pruned instead of the table growing one row per repo per day
 * forever. Idempotent, and bounded per run.
 */
export const pruneStarHistory = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = dayString(Date.now() - HISTORY_RETENTION_DAYS * DAY_MS);
    const stale = await ctx.db
      .query("starHistory")
      .withIndex("by_day", (q) => q.lt("day", cutoff))
      .take(PRUNE_BATCH);
    for (const row of stale) await ctx.db.delete(row._id);
    return { deleted: stale.length };
  },
});
