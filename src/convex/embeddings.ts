/**
 * Repository embedding pipeline.
 *
 * - `backfill`: idempotent cursor-paged backfill over the catalog. Safe to
 *   rerun: rows whose canonical text, model and version are current are
 *   skipped without an API call. Batch-atomic: a failed batch saves nothing
 *   and is retried on the next run.
 * - `embedRepo`: embed (or re-embed) one repository on demand.
 * - `clusteringData`: positive/negative evidence vectors for the
 *   multi-interest model (consumed by the queue generator, PR4).
 *
 * Embeddings are best-effort enrichment: every function degrades to a
 * graceful no-op when no provider key is configured, and ingestion never
 * waits on this pipeline.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { OpenAIEmbeddingProvider } from "./lib/embeddings";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_VERSION,
} from "./recommender/constants";
import { buildRepoText, textHash } from "./recommender/repotext";
import { evidenceWeight } from "./recommender/vectors";

const BACKFILL_PAGE = 25;
/** Cap on negative-evidence vectors returned for the user model. */
const NEGATIVE_VECTORS_CAP = 50;

const embeddingEntryValidator = v.object({
  repoId: v.number(),
  embedding: v.array(v.float64()),
  textHash: v.string(),
});

function providerOrNull(): OpenAIEmbeddingProvider | null {
  try {
    return new OpenAIEmbeddingProvider();
  } catch {
    return null;
  }
}

function providerError(): string {
  return (
    "Embedding provider is not configured (OPENAI_API_KEY is missing from " +
    "server env). Ingestion and the metadata feed keep working; semantic " +
    "retrieval stays off until the key is set and backfill runs."
  );
}

/** One unit of embedding work: canonical text plus current index state. */
export interface EmbeddingWorkItem {
  repoId: number;
  text: string;
  hash: string;
  current: { model: string; version: number; textHash: string } | null;
}
export const embeddingWork = internalQuery({
  args: { cursor: v.number(), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const page = Math.max(1, Math.min(limit, BACKFILL_PAGE));
    const repos = await ctx.db
      .query("repos")
      .withIndex("by_repo_id", (q) => q.gt("repoId", cursor))
      .take(page);
    const items = await Promise.all(
      repos.map(async (repo) => {
        const text = buildRepoText({
          fullName: repo.fullName,
          description: repo.description,
          language: repo.language,
          topics: repo.topics,
          readme: repo.readme,
        });
        const existing = await ctx.db
          .query("repoEmbeddings")
          .withIndex("by_repo_id", (q) => q.eq("repoId", repo.repoId))
          .unique();
        return {
          repoId: repo.repoId,
          text,
          hash: textHash(text),
          current: existing
            ? {
                model: existing.model,
                version: existing.version,
                textHash: existing.textHash,
              }
            : null,
        };
      }),
    );
    const last = repos[repos.length - 1]?.repoId ?? null;
    return { items, nextCursor: repos.length < page ? null : last };
  },
});

export const saveEmbeddings = internalMutation({
  args: { entries: v.array(embeddingEntryValidator) },
  handler: async (ctx, { entries }) => {
    const now = Date.now();
    let saved = 0;
    for (const entry of entries) {
      // Never let a misconfigured model pollute the index.
      if (entry.embedding.length !== EMBEDDING_DIMENSIONS) continue;
      const existing = await ctx.db
        .query("repoEmbeddings")
        .withIndex("by_repo_id", (q) => q.eq("repoId", entry.repoId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          embedding: entry.embedding,
          model: EMBEDDING_MODEL,
          version: EMBEDDING_VERSION,
          textHash: entry.textHash,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("repoEmbeddings", {
          repoId: entry.repoId,
          embedding: entry.embedding,
          model: EMBEDDING_MODEL,
          version: EMBEDDING_VERSION,
          textHash: entry.textHash,
          updatedAt: now,
        });
      }
      saved += 1;
    }
    return { saved };
  },
});

function isCurrent(item: EmbeddingWorkItem): boolean {
  return (
    item.current !== null &&
    item.current.model === EMBEDDING_MODEL &&
    item.current.version === EMBEDDING_VERSION &&
    item.current.textHash === item.hash
  );
}

async function embedAndSave(
  ctx: ActionCtx,
  provider: OpenAIEmbeddingProvider,
  due: { repoId: number; text: string; hash: string }[],
): Promise<{ embedded: number; failures: number; error: string | null }> {
  if (due.length === 0) return { embedded: 0, failures: 0, error: null };
  let vectors: number[][];
  try {
    vectors = await provider.embed(due.map((item) => item.text));
  } catch (error) {
    return {
      embedded: 0,
      failures: due.length,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  await ctx.runMutation(internal.embeddings.saveEmbeddings, {
    entries: due.map((item, index) => ({
      repoId: item.repoId,
      embedding: vectors[index],
      textHash: item.hash,
    })),
  });
  return { embedded: due.length, failures: 0, error: null };
}

export const backfill = action({
  args: {
    cursor: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to run the embedding backfill.");
    const provider = providerOrNull();
    if (!provider) return { embedded: 0, skipped: 0, error: providerError() };

    const {
      items,
      nextCursor,
    }: { items: EmbeddingWorkItem[]; nextCursor: number | null } =
      await ctx.runQuery(internal.embeddings.embeddingWork, {
        cursor: cursor ?? 0,
        limit: limit ?? BACKFILL_PAGE,
      });
    const due = items.filter((item) => !isCurrent(item));
    const result = await embedAndSave(ctx, provider, due);
    return {
      ...result,
      skipped: items.length - due.length,
      nextCursor,
      done: nextCursor === null,
    };
  },
});

/** Embed one repository immediately (e.g. after README enrichment). */
export const embedRepo = action({
  args: { repoId: v.number() },
  handler: async (ctx, { repoId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to embed repositories.");
    const provider = providerOrNull();
    if (!provider) return { embedded: false, error: providerError() };

    const target = await ctx.runQuery(internal.embeddings.workForRepo, {
      repoId,
    });
    if (!target) return { embedded: false, error: "Repository not found." };
    if (isCurrent(target)) return { embedded: false, error: null };
    const result = await embedAndSave(ctx, provider, [target]);
    return { embedded: result.embedded === 1, error: result.error };
  },
});

/** Canonical text + current embedding state for a single repository. */
export const workForRepo = internalQuery({
  args: { repoId: v.number() },
  handler: async (ctx, { repoId }) => {
    const repo = await ctx.db
      .query("repos")
      .withIndex("by_repo_id", (q) => q.eq("repoId", repoId))
      .unique();
    if (!repo) return null;
    const text = buildRepoText({
      fullName: repo.fullName,
      description: repo.description,
      language: repo.language,
      topics: repo.topics,
      readme: repo.readme,
    });
    const existing = await ctx.db
      .query("repoEmbeddings")
      .withIndex("by_repo_id", (q) => q.eq("repoId", repoId))
      .unique();
    return {
      repoId,
      text,
      hash: textHash(text),
      current: existing
        ? {
            model: existing.model,
            version: existing.version,
            textHash: existing.textHash,
          }
        : null,
    };
  },
});

/**
 * Evidence vectors for one user's multi-interest model: positive repos with
 * behavioural weights plus a bounded set of negative-region vectors.
 * Pure clustering happens in `recommender/vectors.ts`; this only assembles
 * the inputs. Consumed by the queue generator (PR4) and the eval harness.
 */
export const clusteringData = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("ratings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const positives: { repoId: number; vector: number[]; weight: number }[] =
      [];
    const negatives: number[][] = [];
    for (const row of rows) {
      const embedding = await ctx.db
        .query("repoEmbeddings")
        .withIndex("by_repo_id", (q) => q.eq("repoId", row.repoId))
        .unique();
      if (!embedding) continue;
      const weight = evidenceWeight({
        value: row.value,
        saved: row.saved,
        githubOpens: row.githubOpens,
      });
      if (weight > 0) {
        positives.push({
          repoId: row.repoId,
          vector: embedding.embedding,
          weight,
        });
      } else if (
        (row.hidden === true ||
          (typeof row.value === "number" && row.value <= 2)) &&
        negatives.length < NEGATIVE_VECTORS_CAP
      ) {
        negatives.push(embedding.embedding);
      }
    }
    return { positives, negatives };
  },
});
