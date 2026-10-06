import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import { normalizeTopic, type DiscoveredRepo } from "./feed";

const GITHUB_SEARCH_URL = "https://api.github.com/search/repositories";
const RESULTS_PER_TOPIC = 40;

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

export interface SyncResult {
  slug: string;
  /** Repositories this sync added to the cache for the first time. */
  added: number;
  /** How many repositories GitHub returned for the topic. */
  fetched: number;
  /** Error message when the topic could not be synced, otherwise null. */
  error: string | null;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-interest-feed",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // Optional: a personal access token raises GitHub's rate limit from
  // 10 to 30 searches per minute. Everything works without it.
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
    return `GitHub is limiting requests. Try again in about ${minutes} minute${
      minutes === 1 ? "" : "s"
    }, or add a GITHUB_TOKEN for a higher limit.`;
  }
  return "GitHub is limiting requests right now. Try again in a minute.";
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

/** Search GitHub for the most-starred repositories tagged with `slug`. */
async function fetchTopicRepos(slug: string): Promise<DiscoveredRepo[]> {
  const url = new URL(GITHUB_SEARCH_URL);
  url.searchParams.set("q", `topic:${slug}`);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(RESULTS_PER_TOPIC));

  const response = await fetch(url.toString(), {
    headers: githubHeaders(),
  });

  if (response.status === 403 || response.status === 429) {
    throw new Error(rateLimitMessage(response));
  }
  if (!response.ok) {
    throw new Error(
      `GitHub responded with ${response.status} for topic "${slug}".`,
    );
  }

  const payload = (await response.json()) as GitHubSearchResponse;
  return (payload.items ?? []).map(mapItem);
}

async function syncOneTopic(
  ctx: ActionCtx,
  userId: Id<"users">,
  slug: string,
): Promise<SyncResult> {
  try {
    const repos = await fetchTopicRepos(slug);
    const saved = await ctx.runMutation(internal.feed.saveDiscoveredRepos, {
      userId,
      topicSlug: slug,
      repos,
    });
    return { slug, added: saved.added, fetched: repos.length, error: null };
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
}

/** Fetch repositories for a single topic (called right after a topic is added). */
export const syncTopic = action({
  args: { topic: v.string() },
  handler: async (ctx, { topic }): Promise<SyncResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to fetch projects.");
    const slug = normalizeTopic(topic);
    if (!slug) throw new Error('Enter a topic like "rust" or "devtools".');
    return await syncOneTopic(ctx, userId, slug);
  },
});

/**
 * Refresh every topic the user follows. Runs one search per topic, so with
 * more than a handful of topics GitHub may rate limit the tail end; those
 * failures are reported per topic instead of failing the whole refresh.
 */
export const syncAllTopics = action({
  args: {},
  handler: async (ctx): Promise<{ results: SyncResult[] }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to fetch projects.");

    const slugs: string[] = await ctx.runQuery(
      internal.feed.topicSlugsForUser,
      { userId },
    );

    const results: SyncResult[] = [];
    for (const slug of slugs) {
      results.push(await syncOneTopic(ctx, userId, slug));
    }
    return { results };
  },
});
