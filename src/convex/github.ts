import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { normalizeTopic, type DiscoveredRepo } from "./feed";
import { extractImages, readmeUrls } from "./lib/readme";

const GITHUB_SEARCH_URL = "https://api.github.com/search/repositories";
const USER_AGENT = "gitbook";
const RESULTS_PER_SEARCH = 30;
/** READMEs are fetched a few at a time, for the cards about to be shown. */
const MAX_ENRICH_PER_CALL = 6;
const README_ATTEMPTS = 3;
/** Star imports are chunked so no single mutation runs past its limits. */
const SAVE_CHUNK = 100;
const SNAPSHOT_CHUNK = 50;
/** How many repos one snapshot refresh pass chases at once. */
const SNAPSHOT_TARGETS = 40;
/** Concurrent fetches per snapshot batch. */
const SNAPSHOT_CONCURRENCY = 8;
/** A rate limit defers the rest of the work instead of dropping it. */
const MAX_SNAPSHOT_RETRIES = 2;
const SNAPSHOT_RETRY_MIN_MS = 60_000;
const SNAPSHOT_RETRY_MAX_MS = 6 * 60 * 60 * 1000;
const SNAPSHOT_RETRY_DEFAULT_MS = 15 * 60 * 1000;

interface SearchSpec {
  topic: string;
  sort: "stars" | "updated";
  page: number;
  /** GitHub `stars:` qualifier chosen by the planner, e.g. " stars:25..500". */
  stars: string;
}

interface GitHubSearchItem {
  id: number;
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics?: string[];
  pushed_at: string | null;
  archived?: boolean;
  owner?: { login?: string } | null;
  license?: { spdx_id?: string | null } | null;
}

interface GitHubSearchResponse {
  items?: GitHubSearchItem[];
}

export interface FetchResult {
  /** Projects this fetch added to the catalog for the first time. */
  added: number;
  /** Projects GitHub returned across all searches. */
  fetched: number;
  errors: { topic: string; message: string }[];
}

export interface TopicSyncResult {
  slug: string;
  added: number;
  fetched: number;
  error: string | null;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // Optional: a personal access token raises GitHub's rate limit from
  // 10 to 30 searches per minute. Discovery works without it.
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function rateLimitMessage(response: Response): string {
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    const minutes = Math.max(
      1,
      Math.ceil((reset * 1000 - Date.now()) / 60_000),
    );
    return `GitHub is limiting searches. Try again in about ${minutes} minute${
      minutes === 1 ? "" : "s"
    }, or add a GITHUB_TOKEN for a higher limit.`;
  }
  return "GitHub is limiting searches right now. The feed will try again shortly.";
}

function mapItem(item: GitHubSearchItem): DiscoveredRepo {
  return {
    repoId: item.id,
    fullName: item.full_name,
    owner: item.owner?.login ?? item.full_name.split("/")[0] ?? "",
    name: item.name,
    description: item.description || undefined,
    url: item.html_url,
    homepage: item.homepage || undefined,
    stars: item.stargazers_count ?? 0,
    forks: item.forks_count ?? 0,
    openIssues: item.open_issues_count ?? 0,
    language: item.language || undefined,
    topics: Array.isArray(item.topics) ? item.topics.slice(0, 12) : [],
    license:
      item.license?.spdx_id && item.license.spdx_id !== "NOASSERTION"
        ? item.license.spdx_id
        : undefined,
    pushedAt: item.pushed_at ? Date.parse(item.pushed_at) : undefined,
    archived: Boolean(item.archived),
  };
}

async function searchRepos(spec: SearchSpec): Promise<DiscoveredRepo[]> {
  const url = new URL(GITHUB_SEARCH_URL);
  url.searchParams.set("q", `topic:${spec.topic}${spec.stars}`);
  url.searchParams.set("sort", spec.sort);
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(RESULTS_PER_SEARCH));
  url.searchParams.set("page", String(spec.page));

  const response = await fetch(url.toString(), { headers: githubHeaders() });

  if (response.status === 403 || response.status === 429) {
    throw new Error(rateLimitMessage(response));
  }
  if (!response.ok) {
    throw new Error(
      `GitHub responded with ${response.status} for topic "${spec.topic}".`,
    );
  }

  const payload = (await response.json()) as GitHubSearchResponse;
  return (payload.items ?? []).map(mapItem);
}

async function storeRepos(
  ctx: ActionCtx,
  userId: Id<"users">,
  topicSlug: string,
  repos: DiscoveredRepo[],
): Promise<number> {
  if (repos.length === 0) return 0;
  const saved = await ctx.runMutation(internal.feed.saveDiscoveredRepos, {
    userId,
    topicSlug,
    repos,
  });
  // Star counts are recorded whenever we observe them, so growth over time
  // can be diffed later.
  await ctx.runMutation(internal.feed.recordStarSnapshots, {
    entries: repos.map((repo) => ({ repoId: repo.repoId, stars: repo.stars })),
  });
  return saved.added;
}

/**
 * Pull the next batch of projects into the catalog. The queries come from the
 * user's own topics, the topics of what they rated highly, and a broad pool, so
 * the feed keeps going even when no topics have been followed.
 */
export const fetchMore = action({
  args: { count: v.optional(v.number()) },
  handler: async (ctx, { count }): Promise<FetchResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to load your feed.");

    const { specs } = await ctx.runMutation(internal.feed.planSearches, {
      userId,
      count: count ?? 2,
    });

    let added = 0;
    let fetched = 0;
    const errors: { topic: string; message: string }[] = [];

    for (const spec of specs) {
      try {
        const repos = await searchRepos(spec);
        fetched += repos.length;
        added += await storeRepos(ctx, userId, spec.topic, repos);
      } catch (error) {
        const message = errorMessage(error);
        errors.push({ topic: spec.topic, message });
        try {
          await ctx.runMutation(internal.feed.markTopicError, {
            userId,
            topicSlug: spec.topic,
            message,
          });
        } catch {
          // Recording the failure is best effort.
        }
      }
    }

    return { added, fetched, errors };
  },
});

/** Fetch one topic the user just followed, so it shows up right away. */
export const syncTopic = action({
  args: { topic: v.string() },
  handler: async (ctx, { topic }): Promise<TopicSyncResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to follow topics.");
    const slug = normalizeTopic(topic);
    if (!slug) throw new Error('Enter a topic like "rust" or "devtools".');

    try {
      // A followed topic is taken at face value: its most popular projects.
      const repos = await searchRepos({
        topic: slug,
        sort: "stars",
        page: 1,
        stars: "",
      });
      const added = await storeRepos(ctx, userId, slug, repos);
      return { slug, added, fetched: repos.length, error: null };
    } catch (error) {
      const message = errorMessage(error);
      try {
        await ctx.runMutation(internal.feed.markTopicError, {
          userId,
          topicSlug: slug,
          message,
        });
      } catch {
        // Recording the failure is best effort.
      }
      return { slug, added: 0, fetched: 0, error: message };
    }
  },
});

/**
 * Read a README straight from GitHub's raw host (outside the API rate limit)
 * and keep the screenshots it references. Cards render the result reactively.
 */
export const enrich = action({
  args: { repoIds: v.array(v.number()) },
  handler: async (ctx, { repoIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to load your feed.");

    const pending: { repoId: number; fullName: string }[] = await ctx.runQuery(
      internal.feed.projectsToEnrich,
      { repoIds: repoIds.slice(0, MAX_ENRICH_PER_CALL) },
    );
    if (pending.length === 0) return { enriched: 0 };

    const entries = await Promise.all(
      pending.map(async (project) => {
        const readme = await fetchReadme(project.fullName);
        return {
          repoId: project.repoId,
          readme,
          images: readme ? extractImages(readme, project.fullName) : [],
        };
      }),
    );

    await ctx.runMutation(internal.feed.saveEnrichment, { entries });
    return { enriched: entries.length };
  },
});

/**
 * Import a user's public GitHub stars as an instant taste profile: every
 * starred project becomes an implicit 4/5 rating the feed learns from right
 * away, instead of asking for ten manual ratings first.
 */
export const importStars = action({
  args: { username: v.string() },
  handler: async (
    ctx,
    { username },
  ): Promise<{
    imported: number;
    total: number;
    skipped: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to import stars.");

    const clean = username.trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9-]{1,39}$/.test(clean)) {
      throw new Error("That does not look like a GitHub username.");
    }

    // Stars are public: no OAuth needed. Up to 500, a hundred per page.
    const repos: DiscoveredRepo[] = [];
    for (let page = 1; page <= 5; page += 1) {
      const response = await fetch(
        `https://api.github.com/users/${clean}/starred?per_page=100&page=${page}`,
        { headers: githubHeaders() },
      );
      if (response.status === 404) {
        throw new Error(`GitHub has no user called "${clean}".`);
      }
      if (response.status === 403 || response.status === 429) {
        throw new Error(rateLimitMessage(response));
      }
      if (!response.ok) {
        throw new Error(`GitHub responded with ${response.status}.`);
      }
      const items = (await response.json()) as GitHubSearchItem[];
      if (!Array.isArray(items) || items.length === 0) break;
      repos.push(...items.map(mapItem));
      if (items.length < 100) break;
    }

    if (repos.length === 0) {
      return { imported: 0, total: 0, skipped: 0 };
    }

    // Everything is chunked and awaited before the next chunk starts, so a
    // 500-star import never pushes one mutation past its limits and the
    // counts below are only reported once everything has landed.
    for (let start = 0; start < repos.length; start += SAVE_CHUNK) {
      const chunk = repos.slice(start, start + SAVE_CHUNK);
      await ctx.runMutation(internal.feed.saveDiscoveredRepos, {
        userId,
        topicSlug: "github-stars",
        repos: chunk,
      });
      for (let s = 0; s < chunk.length; s += SNAPSHOT_CHUNK) {
        await ctx.runMutation(internal.feed.recordStarSnapshots, {
          entries: chunk.slice(s, s + SNAPSHOT_CHUNK).map((repo) => ({
            repoId: repo.repoId,
            stars: repo.stars,
          })),
        });
      }
    }
    let imported = 0;
    let skipped = 0;
    for (let start = 0; start < repos.length; start += SAVE_CHUNK) {
      const result = await ctx.runMutation(internal.feed.applyStarImport, {
        userId,
        repoIds: repos
          .slice(start, start + SAVE_CHUNK)
          .map((repo) => repo.repoId),
      });
      imported += result.imported;
      skipped += result.skipped;
    }
    return { imported, total: repos.length, skipped };
  },
});

/**
 * Daily heartbeat for star velocity: refresh live star counts for the
 * catalog's fastest movers and newest arrivals so growth can be diffed even
 * when nobody is browsing.
 */
interface SnapshotTarget {
  repoId: number;
  fullName: string;
}

type SnapshotFetch =
  | { target: SnapshotTarget; entry: { repoId: number; stars: number } }
  | { target: SnapshotTarget; entry: null; retryAt: number | null };

/** When a rate-limited response says the budget lifts, or a sane default. */
function rateLimitResetAt(response: Response): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Date.now() + retryAfter * 1000;
  }
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) return reset * 1000;
  return Date.now() + SNAPSHOT_RETRY_DEFAULT_MS;
}

async function fetchStarCount(target: SnapshotTarget): Promise<SnapshotFetch> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${target.fullName}`,
      { headers: githubHeaders() },
    );
    if (response.status === 403 || response.status === 429) {
      return { target, entry: null, retryAt: rateLimitResetAt(response) };
    }
    if (!response.ok) return { target, entry: null, retryAt: null };
    const payload = (await response.json()) as { stargazers_count?: number };
    if (typeof payload.stargazers_count !== "number") {
      return { target, entry: null, retryAt: null };
    }
    return {
      target,
      entry: { repoId: target.repoId, stars: payload.stargazers_count },
    };
  } catch {
    // Best effort: tomorrow's run catches up.
    return { target, entry: null, retryAt: null };
  }
}

export const refreshStarSnapshots = internalAction({
  args: {
    attempt: v.optional(v.number()),
    targets: v.optional(
      v.array(v.object({ repoId: v.number(), fullName: v.string() })),
    ),
  },
  handler: async (ctx, { attempt, targets: deferred }) => {
    const targets: SnapshotTarget[] =
      deferred ??
      (await ctx.runQuery(internal.feed.reposToRefresh, {
        limit: SNAPSHOT_TARGETS,
      }));
    const tries = attempt ?? 0;

    const entries: { repoId: number; stars: number }[] = [];
    const remaining: SnapshotTarget[] = [];
    let rateLimited = false;
    let retryAt: number | null = null;

    // Small concurrent batches: sequential fetches were slow for no gain.
    for (let start = 0; start < targets.length; start += SNAPSHOT_CONCURRENCY) {
      const batch = targets.slice(start, start + SNAPSHOT_CONCURRENCY);
      const results = await Promise.all(batch.map(fetchStarCount));
      for (const result of results) {
        if (result.entry) {
          entries.push(result.entry);
          continue;
        }
        if (result.retryAt !== null) {
          // Rate limited: keep what we got, defer this repo with the rest.
          rateLimited = true;
          retryAt = Math.max(retryAt ?? 0, result.retryAt);
          remaining.push(result.target);
        }
      }
      if (rateLimited) {
        // Nothing later in the list can be fetched either; defer it all.
        remaining.push(...targets.slice(start + batch.length));
        break;
      }
    }

    if (entries.length > 0) {
      await ctx.runMutation(internal.feed.recordStarSnapshots, { entries });
    }
    // The pass stops at a rate limit but the work does not disappear: what was
    // left over is retried when the budget resets, a bounded number of times.
    if (remaining.length > 0 && tries < MAX_SNAPSHOT_RETRIES) {
      const when = retryAt ?? Date.now() + SNAPSHOT_RETRY_DEFAULT_MS;
      const delay = Math.min(
        Math.max(when - Date.now(), SNAPSHOT_RETRY_MIN_MS),
        SNAPSHOT_RETRY_MAX_MS,
      );
      await ctx.scheduler.runAfter(
        delay,
        internal.github.refreshStarSnapshots,
        {
          attempt: tries + 1,
          targets: remaining.slice(0, SNAPSHOT_TARGETS),
        },
      );
    }
    return { refreshed: entries.length, deferred: remaining.length };
  },
});

async function fetchReadme(fullName: string): Promise<string | null> {
  for (const url of readmeUrls(fullName).slice(0, README_ATTEMPTS)) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (response.ok) return await response.text();
      // Only a missing file is worth another guess at the file name.
      if (response.status !== 404) return null;
    } catch {
      return null;
    }
  }
  return null;
}
