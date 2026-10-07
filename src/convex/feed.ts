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
export function toProject(repo: Doc<"repos">, interaction: Doc<"ratings"> | null) {
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

function countBy(values: Iterable<string>, counts: Map<string, number>): void {
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
}

/** Keeps the strongest dislike for a facet; repeated skips do not stack. */
function lower(
  map: Map<string, number>,
  names: Iterable<string>,
  amount: number,
): void {
  for (const name of names) map.set(name, Math.min(map.get(name) ?? 0, amount));
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
const STARS_WEIGHT = 0.22;
const STARS_CAP = 0.9;
/**
 * Star velocity: growth and acceleration outrank raw size, so "before it was
 * big" beats "already famous" — the whole point of a discovery feed.
 */
const VELOCITY_WEIGHT = 0.55;
const VELOCITY_CAP = 1.7;
const ACCEL_WEIGHT = 0.3;
const ACCEL_CAP = 0.6;
const JITTER_WEIGHT = 0.9;
/** Freshness decays like a Reddit/HN score instead of a flat recent bonus. */
const FRESH_HALF_LIFE_DAYS = 45;
const FRESH_WEIGHT = 1;
const AFFINITY_TOPIC = 0.4;
const AFFINITY_LANGUAGE = 0.6;
const AFFINITY_OWNER = 0.6;
/**
 * A skip or a 1-2 rating is a far stronger statement than a 4-5, the way X
 * weights negative actions above positive ones.
 */
const DISLIKE_TOPIC = -0.8;
const DISLIKE_LANGUAGE = -1;
const DISLIKE_OWNER = -1.6;
/** Optimism under uncertainty: the bandit rule for under-exposed facets. */
const EXPLORE_WEIGHT = 1.1;
/** X's "new author boost", applied to a first sighting of a language/owner. */
const FIRST_SIGHTING_BOOST = 0.45;
/** Similarity cost in the reranker — X's DPP reranker, cheaply. */
const SIMILARITY_PENALTY = 0.55;
/** X's repeated-author decay, applied per owner inside one window. */
const REPEAT_DECAY = 0.55;
const REPEAT_FLOOR = 0.18;
/**
 * Milder per-language decay. Languages don't show up in Jaccard similarity
 * strongly enough to stop one ecosystem flooding a window, so a couple of a
 * language are free and each further one costs a little.
 */
const LANGUAGE_REPEAT_FREE = 2;
const LANGUAGE_REPEAT_DECAY = 0.8;
const LANGUAGE_REPEAT_FLOOR = 0.5;
/** Slots in every window reserved for exploration instead of score. */
const EXPLORE_SLOTS = 6;
/** Scored candidates the selector chooses from, after the catalog scan. */
const CANDIDATE_POOL = 400;

/** 1 while a project is fresh, 0.5 at the half-life, →0 as it ages. */
function freshness(pushedAt: number | undefined, now: number): number {
  if (!pushedAt) return 0;
  const ageDays = Math.max(0, (now - pushedAt) / 86_400_000);
  return 0.5 ** (ageDays / FRESH_HALF_LIFE_DAYS);
}

/**
 * Optimism under uncertainty (the bandit rule): a facet the viewer has barely
 * been shown can still teach the feed something, so it is worth surfacing.
 */
function optimism(impressions: number, total: number): number {
  return Math.sqrt(Math.log(total + 2) / (1 + impressions));
}

/** Everything a similarity check cares about: topics, language and owner. */
function facetsOf(repo: Doc<"repos">): Set<string> {
  const facets = new Set<string>();
  for (const topic of repo.topics) facets.add(`t:${topic}`);
  if (repo.language) facets.add(`l:${repo.language}`);
  facets.add(`o:${repo.owner}`);
  return facets;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** How much of a project's facets the viewer has never been shown at all. */
function unexploredness(repo: Doc<"repos">, signals: Signals): number {
  let novelty = 0;
  if (repo.language && (signals.languageSeen.get(repo.language) ?? 0) === 0) {
    novelty += 1;
  }
  if ((signals.ownerSeen.get(repo.owner) ?? 0) === 0) novelty += 1;
  if (repo.topics.length > 0) {
    let sum = 0;
    for (const topic of repo.topics) {
      sum += optimism(signals.topicSeen.get(topic) ?? 0, signals.totalImpressions);
    }
    novelty += sum / repo.topics.length;
  }
  return novelty;
}

interface Signals {
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

interface Scored {
  repo: Doc<"repos">;
  score: number;
  /** How much of this project the viewer has never been shown. */
  explore: number;
  facets: Set<string>;
}

/**
 * One weighted sum over the signals we have — the same shape as X's
 * `RankingScorer`, which blends predicted actions into a single score.
 */
function scoreProject(repo: Doc<"repos">, signals: Signals): number {
  if (repo.archived) return -100;

  let score = Math.min(Math.log10(repo.stars + 1) * STARS_WEIGHT, STARS_CAP);
  score += freshness(repo.pushedAt, signals.now) * FRESH_WEIGHT;

  // Star velocity beats star count: a project gaining stars fast — or
  // accelerating — is worth seeing before everyone else has.
  const growth = repo.starGrowth7d ?? 0;
  if (growth > 0) {
    score += Math.min(VELOCITY_CAP, Math.log10(1 + growth) * VELOCITY_WEIGHT);
  }
  const accel = repo.starAccel ?? 0;
  if (accel > 0) {
    score += Math.min(ACCEL_CAP, Math.log10(1 + accel) * ACCEL_WEIGHT);
  }

  // A project is as interesting as its best topic, not the sum of all twelve:
  // otherwise a repo tagged with everything outranks one tagged honestly.
  let topicAffinityMax = 0;
  let topicDislikeMax = 0;
  let topicExplore = 0;
  for (const topic of repo.topics) {
    topicAffinityMax = Math.max(topicAffinityMax, signals.topicAffinity.get(topic) ?? 0);
    topicDislikeMax = Math.min(topicDislikeMax, signals.topicDislike.get(topic) ?? 0);
    topicExplore += optimism(signals.topicSeen.get(topic) ?? 0, signals.totalImpressions);
  }
  score += affinityWeight(topicAffinityMax) * AFFINITY_TOPIC;
  score += topicDislikeMax;
  if (repo.topics.length > 0) {
    score += (topicExplore / repo.topics.length) * EXPLORE_WEIGHT * 0.4;
  }

  if (repo.language) {
    const seen = signals.languageSeen.get(repo.language) ?? 0;
    score += affinityWeight(signals.languageAffinity.get(repo.language) ?? 0) * AFFINITY_LANGUAGE;
    score += signals.languageDislike.get(repo.language) ?? 0;
    score += optimism(seen, signals.totalImpressions) * EXPLORE_WEIGHT * 0.8;
    if (seen === 0) score += FIRST_SIGHTING_BOOST;
  }

  const ownerSeen = signals.ownerSeen.get(repo.owner) ?? 0;
  score += affinityWeight(signals.ownerAffinity.get(repo.owner) ?? 0) * AFFINITY_OWNER;
  score += signals.ownerDislike.get(repo.owner) ?? 0;
  score += optimism(ownerSeen, signals.totalImpressions) * EXPLORE_WEIGHT * 0.5;
  if (ownerSeen === 0) score += FIRST_SIGHTING_BOOST;

  // Never lose a project to a tie: the jitter is stable per project.
  score += ((repo.repoId % 997) / 997) * JITTER_WEIGHT;
  return score;
}

/**
 * Greedy reranker. X's `vm-ranker` reorders scored posts with a determinantal
 * point process so neighbours are less alike — "giving up a little score for
 * less similarity" — and decays a repeated author's posts. This is the cheap
 * version of both: take the project that is worth the most after subtracting
 * its similarity to the window, and decay owners already in it.
 */
function selectWindow(pool: Scored[], size: number): Scored[] {
  const chosen: Scored[] = [];
  const remaining = [...pool];
  const ownerRepeats = new Map<string, number>();
  const languageRepeats = new Map<string, number>();

  while (chosen.length < size && remaining.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;

    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index];
      let similarity = 0;
      for (const picked of chosen) {
        similarity = Math.max(similarity, jaccard(entry.facets, picked.facets));
      }
      const repeats = ownerRepeats.get(entry.repo.owner) ?? 0;
      const decay = repeats === 0 ? 1 : Math.max(REPEAT_FLOOR, REPEAT_DECAY ** repeats);
      const language = entry.repo.language;
      const languageCount = language ? (languageRepeats.get(language) ?? 0) : 0;
      const languageDecay =
        languageCount < LANGUAGE_REPEAT_FREE
          ? 1
          : Math.max(
              LANGUAGE_REPEAT_FLOOR,
              LANGUAGE_REPEAT_DECAY ** (languageCount - LANGUAGE_REPEAT_FREE + 1),
            );
      const value = (entry.score - SIMILARITY_PENALTY * similarity) * decay * languageDecay;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }

    const [picked] = remaining.splice(bestIndex, 1);
    chosen.push(picked);
    ownerRepeats.set(picked.repo.owner, (ownerRepeats.get(picked.repo.owner) ?? 0) + 1);
    if (picked.repo.language) {
      languageRepeats.set(
        picked.repo.language,
        (languageRepeats.get(picked.repo.language) ?? 0) + 1,
      );
    }
  }

  return chosen;
}

/** Spread exploration picks through the window instead of bunching them up. */
function interleave(explore: Scored[], ranked: Scored[], size: number): Scored[] {
  if (explore.length === 0) return ranked.slice(0, size);
  const every = Math.max(1, Math.round(size / explore.length));
  const out: Scored[] = [];
  let e = 0;
  let r = 0;
  while (out.length < size && (e < explore.length || r < ranked.length)) {
    if (e < explore.length && out.length % every === 0) {
      out.push(explore[e]);
      e += 1;
    } else if (r < ranked.length) {
      out.push(ranked[r]);
      r += 1;
    } else {
      out.push(explore[e]);
      e += 1;
    }
  }
  return out;
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
    const repos = await ctx.db.query("repos").collect();
    const byId = new Map(repos.map((repo) => [repo.repoId, repo]));

    const signals: Signals = {
      now: Date.now(),
      totalImpressions: 0,
      topicAffinity: new Map(),
      languageAffinity: new Map(),
      ownerAffinity: new Map(),
      topicDislike: new Map(),
      languageDislike: new Map(),
      ownerDislike: new Map(),
      topicSeen: new Map(),
      languageSeen: new Map(),
      ownerSeen: new Map(),
    };

    for (const row of rows) {
      const repo = byId.get(row.repoId);
      if (!repo) continue;

      // Every row is one impression, which is what "exposure" means here.
      // Counting it from the catalog we already read costs no extra queries.
      signals.totalImpressions += 1;
      countBy(repo.topics, signals.topicSeen);
      if (repo.language) countBy([repo.language], signals.languageSeen);
      countBy([repo.owner], signals.ownerSeen);

      if ((row.value ?? 0) >= 4) {
        countBy(repo.topics, signals.topicAffinity);
        if (repo.language) countBy([repo.language], signals.languageAffinity);
        countBy([repo.owner], signals.ownerAffinity);
        continue;
      }

      const skipped = row.hidden === true;
      const uninteresting = typeof row.value === "number" && row.value <= 2;
      if (!skipped && !uninteresting) continue;
      // A skip says more than a low score does.
      const weight = skipped ? 1 : 0.6;
      lower(signals.topicDislike, repo.topics, DISLIKE_TOPIC * weight);
      if (repo.language) {
        lower(signals.languageDislike, [repo.language], DISLIKE_LANGUAGE * weight);
      }
      lower(signals.ownerDislike, [repo.owner], DISLIKE_OWNER * weight);
    }

    const excluded = new Set(excludeRepoIds ?? []);
    const candidates = repos.filter(
      (repo) => !touched.has(repo.repoId) && !excluded.has(repo.repoId),
    );

    const size = Math.max(1, Math.min(limit ?? FEED_WINDOW, FEED_WINDOW));
    const scored: Scored[] = candidates.map((repo) => ({
      repo,
      score: scoreProject(repo, signals),
      explore: unexploredness(repo, signals),
      facets: facetsOf(repo),
    }));

    const pool = scored
      .sort((a, b) => b.score - a.score || a.repo.repoId - b.repo.repoId)
      .slice(0, CANDIDATE_POOL);

    // A slice of every window is chosen for exploration rather than for score,
    // from the facets the viewer has never met — the bandit-style half of the
    // feed that keeps whole domains from staying invisible forever. The slice
    // cools as impressions accumulate: early on the feed is mostly discovery,
    // later it leans on what it has learned and exploration halves.
    const exploreCool = Math.max(0.5, 1 - signals.totalImpressions / 300);
    const exploreSlots = Math.min(
      EXPLORE_SLOTS,
      Math.max(1, Math.floor((size / 3) * exploreCool)),
    );
    const explorers = selectWindow(
      pool
        .filter((entry) => entry.explore >= 1)
        .sort((a, b) => b.explore - a.explore || b.score - a.score)
        .slice(0, exploreSlots * 4),
      exploreSlots,
    );
    const exploreIds = new Set(explorers.map((entry) => entry.repo.repoId));
    const ranked = selectWindow(
      pool.filter((entry) => !exploreIds.has(entry.repo.repoId)),
      size - explorers.length,
    );
    const window = interleave(explorers, ranked, size);

    return {
      repoIds: window.map((entry) => entry.repo.repoId),
      remaining: Math.max(0, candidates.length - window.length),
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
 * ------------------------------------------------------------------ */

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
    // A deliberate rating replaces an imported one: clear the implicit flag so
    // the rating counts in stats and Wrapped.
    await upsertInteraction(ctx, userId, repoId, {
      value: clamped,
      implicit: undefined,
    });
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

function dayString(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * Record today's star counts and diff them against about a week ago, so every
 * repo carries its own growth and acceleration for ranking and "rising"
 * labels. Growth without history is simply absent — no guesses.
 */
export const recordStarSnapshots = internalMutation({
  args: {
    entries: v.array(v.object({ repoId: v.number(), stars: v.number() })),
  },
  handler: async (ctx, { entries }) => {
    const now = Date.now();
    const today = dayString(now);
    const weekAgo = dayString(now - 6 * 86_400_000);

    for (const entry of entries.slice(0, 200)) {
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

      const past = await ctx.db
        .query("starHistory")
        .withIndex("by_repo_day", (q) =>
          q.eq("repoId", entry.repoId).lt("day", weekAgo),
        )
        .order("desc")
        .first();
      if (!past) continue;

      const growth = entry.stars - past.stars;
      const earlier = await ctx.db
        .query("starHistory")
        .withIndex("by_repo_day", (q) =>
          q.eq("repoId", entry.repoId).lt("day", past.day),
        )
        .order("desc")
        .first();
      const previousGrowth = earlier ? past.stars - earlier.stars : 0;

      const repo = await ctx.db
        .query("repos")
        .withIndex("by_repo_id", (q) => q.eq("repoId", entry.repoId))
        .unique();
      if (repo) {
        await ctx.db.patch(repo._id, {
          starGrowth7d: growth,
          starAccel: growth - previousGrowth,
        });
      }
    }
    return entries.length;
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
    for (const repoId of [...new Set(repoIds)].slice(0, 500)) {
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
