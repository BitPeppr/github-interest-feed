/**
 * Offline evaluation: metric unit tests, synthetic-universe replay gates,
 * and a printed weight comparison. Run with `npm run eval`.
 *
 * The gates pin behaviour: a future weights change that tanks held-out
 * retrieval or slate diversity fails loudly here before it ships.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS } from "../constants";
import {
  ndcgAtK,
  parseInteractionJson,
  precisionAtK,
  recallAtK,
  replay,
  slateStats,
  timeSplit,
  type EvalEvent,
} from "../eval";
import { repo } from "./fixtures";

describe("metrics", () => {
  it("scores a perfect ranking at 1 and handles edge cases without NaNs", () => {
    const relevant = new Set([1, 2, 3]);
    expect(ndcgAtK([1, 2, 3, 4], relevant, 3)).toBe(1);
    expect(precisionAtK([1, 9, 9], relevant, 3)).toBeCloseTo(1 / 3);
    expect(recallAtK([1, 9, 9], relevant, 3)).toBeCloseTo(1 / 3);
    expect(ndcgAtK([9, 9, 9], relevant, 3)).toBe(0);
    expect(ndcgAtK([], relevant, 10)).toBe(0);
    expect(ndcgAtK([1, 2], new Set(), 10)).toBe(0);
    expect(precisionAtK([1], relevant, 0)).toBe(0);
    for (const value of [
      ndcgAtK([], new Set(), 0),
      precisionAtK([], new Set([1]), 5),
      recallAtK([], new Set([1]), 5),
    ]) {
      expect(Number.isNaN(value)).toBe(false);
    }
  });

  it("rewards front-loaded relevance in NDCG", () => {
    const relevant = new Set([1]);
    expect(ndcgAtK([1, 9, 9], relevant, 3)).toBeGreaterThan(
      ndcgAtK([9, 9, 1], relevant, 3),
    );
  });
});

describe("timeSplit", () => {
  it("holds out later positives and keeps earlier history for training", () => {
    const events: EvalEvent[] = Array.from({ length: 10 }, (_, i) => ({
      repo: repo({ repoId: i + 1 }),
      value: 5,
      at: (i + 1) * 1000,
    }));
    const { train, heldout } = timeSplit(events, 0.3);
    expect(train).toHaveLength(7);
    expect(heldout).toHaveLength(3);
    expect(heldout[0].repo.repoId).toBe(8);
  });

  it("never holds out negatives as retrieval targets", () => {
    const events: EvalEvent[] = [
      { repo: repo({ repoId: 1 }), value: 5, at: 1000 },
      { repo: repo({ repoId: 2 }), value: 1, at: 2000 },
      { repo: repo({ repoId: 3 }), hidden: true, at: 3000 },
    ];
    const { heldout } = timeSplit(events, 0.7);
    expect(heldout.map((event) => event.repo.repoId)).toEqual([1]);
  });
});

describe("slateStats", () => {
  it("measures concentration and provenance shares", () => {
    const stats = slateStats(
      [
        {
          repo: repo({
            repoId: 1,
            owner: "a",
            language: "Rust",
            topics: ["t1"],
            stars: 10,
          }),
          sources: ["exploration", "long-tail"],
        },
        {
          repo: repo({
            repoId: 2,
            owner: "a",
            language: "Rust",
            topics: ["t1"],
            stars: 10,
          }),
          sources: ["ranked", "long-tail"],
        },
        {
          repo: repo({
            repoId: 3,
            owner: "b",
            language: "Go",
            topics: ["t2"],
            stars: 9000,
          }),
          sources: ["ranked"],
        },
      ],
      new Map([
        [1, [1, 0]],
        [2, [1, 0]],
        [3, [0, 1]],
      ]),
    );
    expect(stats.size).toBe(3);
    expect(stats.uniqueOwners).toBe(2);
    expect(stats.uniqueLanguages).toBe(2);
    expect(stats.exploreShare).toBeCloseTo(1 / 3);
    expect(stats.longTailShare).toBeCloseTo(2 / 3);
    expect(stats.avgPairwiseCosine).toBeCloseTo(1 / 3);
  });

  it("returns null similarity without vectors and zeros when empty", () => {
    const stats = slateStats([]);
    expect(stats.avgPairwiseCosine).toBe(null);
    expect(stats.exploreShare).toBe(0);
  });
});

describe("parseInteractionJson", () => {
  it("parses exported rows and rejects garbage", () => {
    const parsed = parseInteractionJson([
      {
        at: 1000,
        value: 5,
        repo: {
          repoId: 1,
          fullName: "a/b",
          owner: "a",
          name: "b",
          stars: 1,
          forks: 0,
          openIssues: 0,
          topics: [],
          archived: false,
          discoveredVia: [],
        },
        vector: [0.1, 0.2],
      },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].vector).toEqual([0.1, 0.2]);
    expect(() => parseInteractionJson({})).toThrow();
    expect(() => parseInteractionJson([{ at: 1 }])).toThrow();
    expect(() =>
      parseInteractionJson([{ at: "x", repo: { repoId: 1 } }]),
    ).toThrow();
  });
});

/* ---------------- synthetic universe replay gates ------------------- */

const DIM = 6;
function basis(index: number, jitter: number, seed: number): number[] {
  const vector = new Array<number>(DIM).fill(0);
  vector[index] = 1;
  // Deterministic pseudo-noise so near-duplicates are similar, not identical.
  let state = seed;
  for (let d = 0; d < DIM; d += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    vector[d] += ((state % 100) / 100 - 0.5) * jitter;
  }
  return vector;
}

interface Persona {
  events: EvalEvent[];
  distractors: EvalEvent[];
  /**
   * Truly irrelevant candidates: disliked or unrelated interests. Same-interest
   * unseen repos are relevant-but-unlabelled — ranking them above a held-out
   * positive is correct behaviour, so the gates measure against these.
   */
  irrelevant: EvalEvent[];
}

function syntheticUniverse(): Persona {
  const interests = [
    { topic: "rust", language: "Rust", dim: 0 },
    { topic: "physics", language: "Julia", dim: 1 },
    { topic: "enterprise-forms", language: "Java", dim: 2 },
    { topic: "seo-tools", language: "PHP", dim: 3 },
  ];
  const repos = new Map<number, EvalEvent>();
  interests.forEach((interest, ii) => {
    for (let k = 0; k < 10; k += 1) {
      const repoId = ii * 10 + k + 1;
      repos.set(repoId, {
        repo: repo({
          repoId,
          stars: 20 + ((repoId * 37) % 800),
          topics: [interest.topic, `${interest.topic}-tools`],
          language: interest.language,
          owner: `owner-${ii}-${k % 3}`,
          pushedAt: 1_750_000_000_000 - k * 86_400_000,
        }),
        vector: basis(interest.dim, 0.3, repoId),
        at: 0,
      });
    }
  });
  const must = (id: number): EvalEvent => {
    const event = repos.get(id);
    if (!event) throw new Error(`missing fixture repo ${id}`);
    return event;
  };
  const at = (n: number) => n * 1000;
  // Persona: loves rust + physics, dislikes enterprise-forms, ignores seo.
  const likes = [1, 2, 3, 4, 11, 12, 13];
  const laterLikes = [5, 6, 14];
  const dislikes = [21, 22, 23];
  const events: EvalEvent[] = [
    ...likes.map((id, i) => ({
      ...must(id),
      value: i % 2 === 0 ? 5 : 4,
      saved: i === 0,
      at: at(i + 1),
    })),
    ...dislikes.map((id, i) => ({
      ...must(id),
      value: 1,
      hidden: i === 0,
      at: at(10 + i),
    })),
    ...laterLikes.map((id, i) => ({
      ...must(id),
      value: 5,
      at: at(20 + i),
    })),
  ];
  const touched = new Set(events.map((event) => event.repo.repoId));
  const distractors = [...repos.values()]
    .filter((event) => !touched.has(event.repo.repoId))
    .map((event) => ({ ...event, at: at(30) }));
  // RepoIds 21-40 are the enterprise-forms (disliked) and seo-tools
  // (unrelated) interests.
  const irrelevant = distractors.filter((event) => event.repo.repoId >= 21);
  return { events, distractors, irrelevant };
}
describe("synthetic replay gates", () => {
  it("ranks held-out positives above irrelevant distractors", () => {
    const { events, irrelevant } = syntheticUniverse();
    const result = replay(events, irrelevant);
    expect(result.heldoutCount).toBe(3);
    expect(result.ndcgAt10).toBeGreaterThanOrEqual(0.7);
    expect(result.precisionAt5).toBeGreaterThanOrEqual(0.6);
    expect(result.recallAt10).toBe(1);
  });

  it("keeps the slate spread across owners and languages", () => {
    const { events, irrelevant } = syntheticUniverse();
    const result = replay(events, irrelevant);
    expect(result.slate.uniqueOwners).toBeGreaterThanOrEqual(3);
    expect(result.slate.uniqueLanguages).toBeGreaterThanOrEqual(2);
    expect(result.slate.longTailShare).toBeGreaterThan(0);
  });
  it("reports the semantic-vs-metadata weight comparison", () => {
    const { events, irrelevant } = syntheticUniverse();
    const metadataOnly = replay(events, irrelevant, {
      ...DEFAULT_WEIGHTS,
      semanticBest: 0,
      semanticWeighted: 0,
      negativeSimilarity: 0,
      explicitTopic: 0,
    });
    const semantic = replay(events, irrelevant);
    console.log(
      `eval Comparison | metadata-only NDCG@10=${metadataOnly.ndcgAt10.toFixed(3)} ` +
        `P@5=${metadataOnly.precisionAt5.toFixed(3)} | semantic NDCG@10=${semantic.ndcgAt10.toFixed(3)} ` +
        `P@5=${semantic.precisionAt5.toFixed(3)} | slate owners=${semantic.slate.uniqueOwners} ` +
        `langs=${semantic.slate.uniqueLanguages} avgCos=${semantic.slate.avgPairwiseCosine?.toFixed(3)}`,
    );
    // On this universe the two agree on topics; semantics must not regress it.
    expect(semantic.ndcgAt10).toBeGreaterThanOrEqual(
      metadataOnly.ndcgAt10 - 1e-9,
    );
  });
});
