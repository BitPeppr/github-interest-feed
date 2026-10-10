/**
 * Embedding provider boundary. All secrets stay server-side: this module is
 * imported only by Convex actions, never by client code.
 *
 * Configure with environment variables on the Convex dashboard / `.env.local`:
 * - `OPENAI_API_KEY` (required for the default provider)
 * - `EMBEDDING_MODEL` (optional override, must match EMBEDDING_DIMENSIONS)
 * - `EMBEDDING_BASE_URL` (optional, OpenAI-compatible endpoint)
 */
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
} from "../recommender/constants";

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** Maximum inputs per embedding request (keeps payloads bounded). */
const BATCH_SIZE = 64;
/** Attempts per batch before the batch is reported failed. */
const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface EmbeddingResponse {
  data?: { embedding?: number[] }[];
}

/**
 * OpenAI-compatible embedding provider (`/v1/embeddings`). Throws on
 * failure — callers isolate failures per batch so one bad batch never
 * poisons a backfill run.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(init?: { apiKey?: string; baseUrl?: string; model?: string }) {
    const apiKey = init?.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Embedding provider needs OPENAI_API_KEY (server env only). " +
          "Ingestion keeps working without embeddings; semantic retrieval " +
          "stays off until the key is configured and backfill runs.",
      );
    }
    this.apiKey = apiKey;
    this.baseUrl =
      init?.baseUrl ??
      process.env.EMBEDDING_BASE_URL ??
      "https://api.openai.com/v1";
    this.model = init?.model ?? process.env.EMBEDDING_MODEL ?? EMBEDDING_MODEL;
    this.dimensions = EMBEDDING_DIMENSIONS;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const batch = texts.slice(start, start + BATCH_SIZE);
      out.push(...(await this.embedBatch(batch)));
    }
    return out;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    let lastError = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/embeddings`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: this.model, input: texts }),
        });
        if (response.status === 429 || response.status >= 500) {
          lastError = `embedding endpoint ${response.status}`;
          await sleep(attempt * 1000);
          continue;
        }
        if (!response.ok) {
          throw new Error(`embedding endpoint ${response.status}`);
        }
        const payload = (await response.json()) as EmbeddingResponse;
        const vectors = (payload.data ?? []).map((row) => row.embedding ?? []);
        if (vectors.length !== texts.length) {
          throw new Error("embedding endpoint returned a short batch");
        }
        for (const vector of vectors) {
          if (vector.length !== this.dimensions) {
            throw new Error(
              `embedding dimension ${vector.length} != ${this.dimensions}; ` +
                `check EMBEDDING_MODEL vs EMBEDDING_DIMENSIONS.`,
            );
          }
        }
        return vectors;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < MAX_ATTEMPTS) await sleep(attempt * 1000);
      }
    }
    throw new Error(
      `embedding failed after ${MAX_ATTEMPTS} attempts: ${lastError}`,
    );
  }
}
