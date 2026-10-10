import { describe, expect, it } from "vitest";
import {
  buildInterestClusters,
  centroid,
  cosine,
  evidenceWeight,
  inAdjacentBand,
  labelClusters,
  retrievePerCluster,
  scoreSemantic,
  selectSemanticWindow,
} from "../vectors";
import { repo } from "./fixtures";

const NOW = 1_750_000_000_000;

// Two well-separated interest directions in a toy 4-D space.
const RUST_A = [1, 0.15, 0.05, 0];
const RUST_B = [0.95, 0.2, 0, 0.05];
const PHYSICS_A = [0.05, 0, 1, 0.1];
const PHYSICS_B = [0, 0.05, 0.9, 0.2];

describe("cosine", () => {
  it("scores identical vectors 1 and orthogonal vectors 0", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });

  it("refuses to compare incompatible spaces", () => {
    expect(() => cosine([1, 0], [1])).toThrow(/dimension mismatch/);
    expect(() => centroid([{ vector: [1], weight: 1 }])).not.toThrow();
  });
});

describe("buildInterestClusters", () => {
  const items = [
    { repoId: 1, vector: RUST_A, weight: 3 },
    { repoId: 2, vector: RUST_B, weight: 3 },
    { repoId: 3, vector: RUST_A, weight: 2 },
    { repoId: 4, vector: PHYSICS_A, weight: 2 },
    { repoId: 5, vector: PHYSICS_B, weight: 2 },
  ];

  it("keeps distinct interests in separate clusters", () => {
    const clusters = buildInterestClusters(items, NOW, { maxClusters: 5 });
    expect(clusters).toHaveLength(2);
    const rust = clusters.find((c) => c.repoIds.includes(1));
    const physics = clusters.find((c) => c.repoIds.includes(4));
    expect(rust).toBeDefined();
    expect(physics).toBeDefined();
    expect(rust?.id).not.toBe(physics?.id);
    // Weights follow evidence, not head counts alone.
    expect(rust?.weight).toBe(8);
    expect(physics?.weight).toBe(4);
  });

  it("does not force-split a single interest", () => {
    const clusters = buildInterestClusters(
      [
        { repoId: 1, vector: RUST_A, weight: 3 },
        { repoId: 2, vector: RUST_B, weight: 2 },
      ],
      NOW,
      { maxClusters: 5 },
    );
    expect(clusters).toHaveLength(1);
  });

  it("is deterministic and sorts members", () => {
    const first = buildInterestClusters(items, NOW);
    const second = buildInterestClusters([...items].reverse(), NOW);
    expect(first.map((c) => c.repoIds)).toEqual(second.map((c) => c.repoIds));
  });

  it("handles empty input", () => {
    expect(buildInterestClusters([], NOW)).toEqual([]);
  });
});

describe("labelClusters", () => {
  it("labels from member topics without a hardcoded taxonomy", () => {
    const clusters = buildInterestClusters(
      [
        { repoId: 1, vector: RUST_A, weight: 3 },
        { repoId: 2, vector: RUST_B, weight: 3 },
        { repoId: 4, vector: PHYSICS_A, weight: 2 },
      ],
      NOW,
      { maxClusters: 5 },
    );
    const reposById = new Map([
      [1, repo({ repoId: 1, topics: ["rust", "cli"] })],
      [2, repo({ repoId: 2, topics: ["rust", "tui"] })],
      [4, repo({ repoId: 4, topics: ["physics", "simulation"] })],
    ]);
    const labelled = labelClusters(clusters, reposById);
    expect(labelled.map((c) => c.label).sort()).toEqual(["physics", "rust"]);
  });
});

describe("retrievePerCluster", () => {
  it("gives every interest its own capped slots", () => {
    const clusters = buildInterestClusters(
      [
        { repoId: 1, vector: RUST_A, weight: 9 },
        { repoId: 4, vector: PHYSICS_A, weight: 1 },
      ],
      NOW,
      { maxClusters: 5 },
    );
    expect(clusters).toHaveLength(2);
    const catalog = [
      { repoId: 10, vector: RUST_A, score: 5 },
      { repoId: 11, vector: RUST_B, score: 5 },
      { repoId: 12, vector: PHYSICS_A, score: 1 },
      { repoId: 13, vector: PHYSICS_B, score: 1 },
    ];
    const per = retrievePerCluster(catalog, clusters, 1);
    expect(per.get("c0")).toHaveLength(1);
    expect(per.get("c1")).toHaveLength(1);
    // The dominant Rust interest cannot steal the physics slot.
    const physicsCluster = clusters.find((c) => c.repoIds.includes(4));
    const physicsPick = per.get(physicsCluster?.id ?? "");
    expect([12, 13]).toContain(physicsPick?.[0]?.repoId);
  });

  it("honours exclusions", () => {
    const clusters = buildInterestClusters(
      [{ repoId: 1, vector: RUST_A, weight: 2 }],
      NOW,
    );
    const per = retrievePerCluster(
      [{ repoId: 10, vector: RUST_A, score: 1 }],
      clusters,
      5,
      new Set([10]),
    );
    expect(per.get("c0")).toEqual([]);
  });
});

describe("scoreSemantic", () => {
  const clusters = buildInterestClusters(
    [
      { repoId: 1, vector: RUST_A, weight: 3 },
      { repoId: 4, vector: PHYSICS_A, weight: 1 },
    ],
    NOW,
    { maxClusters: 5 },
  );

  it("scores on-interest vectors above off-interest ones", () => {
    const on = scoreSemantic(RUST_B, clusters);
    const off = scoreSemantic([0.1, 0.9, 0.1, 0.9], clusters);
    expect(on.best).toBeGreaterThan(off.best);
    expect(on.weighted).toBeGreaterThan(off.weighted);
  });

  it("measures negative-region similarity separately", () => {
    const scored = scoreSemantic(RUST_B, clusters, [RUST_A]);
    expect(scored.negative).toBeCloseTo(1, 1);
    const clean = scoreSemantic(RUST_B, clusters, [PHYSICS_A]);
    expect(clean.negative).toBeLessThan(0.3);
  });
});

describe("inAdjacentBand", () => {
  it("accepts the middle band only", () => {
    expect(inAdjacentBand(0.2)).toBe(false);
    expect(inAdjacentBand(0.5)).toBe(true);
    expect(inAdjacentBand(0.9)).toBe(false);
  });
});

describe("selectSemanticWindow", () => {
  it("repels content duplicates that share no topics", () => {
    const dup = [1, 0.2, 0, 0];
    const pool = [
      { item: "a", score: 10, vector: dup },
      { item: "b", score: 9.5, vector: dup.map((v) => v * 0.99 + 0.001) },
      { item: "c", score: 8.5, vector: [0, 0, 1, 0.2] },
    ];
    const window = selectSemanticWindow(pool, 2);
    expect(window).toEqual(["a", "c"]);
  });
});

describe("evidenceWeight", () => {
  it("orders evidence strength for clustering", () => {
    expect(evidenceWeight({ value: 5 })).toBe(3);
    expect(evidenceWeight({ value: 4 })).toBe(2);
    expect(evidenceWeight({ saved: true })).toBe(1.5);
    expect(evidenceWeight({ value: 3 })).toBe(0.5);
    expect(evidenceWeight({ value: 1 })).toBe(0);
    expect(evidenceWeight({})).toBe(0);
  });
});
