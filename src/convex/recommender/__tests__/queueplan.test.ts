import { describe, expect, it } from "vitest";
import { buildSignals } from "../signals";
import { planQueueBatch } from "../queueplan";
import type { RepoSnapshot } from "../types";
import { buildInterestClusters } from "../vectors";
import { rated, repo } from "./fixtures";

const NOW = 1_750_000_000_000;
const RUST_A = [1, 0.15, 0.05, 0];
const RUST_B = [0.95, 0.2, 0, 0.05];
const PHYSICS_A = [0.05, 0, 1, 0.1];

function rustFan() {
  return buildSignals(NOW, [
    rated(900, 5, {
      topics: ["rust", "cli"],
      language: "Rust",
      owner: "burnt",
    }),
    rated(901, 5, { topics: ["rust", "tui"], language: "Rust", owner: "rat" }),
  ]);
}

function catalog(): RepoSnapshot[] {
  return [
    repo({
      repoId: 1,
      stars: 8000,
      topics: ["rust", "cli"],
      language: "Rust",
      owner: "a",
    }),
    repo({
      repoId: 2,
      stars: 7000,
      topics: ["rust"],
      language: "Rust",
      owner: "b",
    }),
    repo({
      repoId: 3,
      stars: 60,
      topics: ["rust"],
      language: "Rust",
      owner: "c",
    }),
    repo({
      repoId: 4,
      stars: 40,
      topics: ["sonification"],
      language: "SuperCollider",
      owner: "unheard",
    }),
    repo({
      repoId: 5,
      stars: 90000,
      topics: ["javascript", "framework"],
      language: "TypeScript",
      owner: "huge",
    }),
    repo({
      repoId: 6,
      stars: 30,
      topics: ["paper-circuits"],
      language: "Forth",
      owner: "strange",
    }),
    repo({
      repoId: 7,
      stars: 500,
      topics: ["physics"],
      language: "Julia",
      owner: "lab",
    }),
    repo({
      repoId: 8,
      stars: 999999,
      archived: true,
      topics: ["rust"],
      language: "Rust",
      owner: "ghost",
    }),
  ];
}

const VECTORS = new Map<number, number[]>([
  [1, RUST_A],
  [2, RUST_B],
  [3, RUST_B],
  [4, [0.1, 0.9, 0.1, 0.9]],
  [5, [0.2, 0.8, 0.2, 0.7]],
  [6, [0.9, 0.1, 0.9, 0.1]],
  [7, PHYSICS_A],
]);

function clusters() {
  return buildInterestClusters(
    [
      { repoId: 900, vector: RUST_A, weight: 3 },
      { repoId: 901, vector: RUST_B, weight: 2 },
    ],
    NOW,
    { maxClusters: 5 },
  );
}

describe("planQueueBatch", () => {
  it("produces ordered, deduplicated, explained items", () => {
    const plan = planQueueBatch({
      unseen: catalog(),
      signals: rustFan(),
      followedTopics: new Set(),
      caps: { batch: 5 },
    });
    expect(plan.items.length).toBeLessThanOrEqual(5);
    expect(plan.items.length).toBeGreaterThan(0);
    const ids = plan.items.map((item) => item.repoId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of plan.items) {
      expect(item.reasons.length).toBeGreaterThan(0);
      expect(item.sources.length).toBeGreaterThan(0);
    }
    expect(plan.stats.unseenCount).toBe(7);
    expect(plan.stats.candidateCount).toBeGreaterThan(0);
  });

  it("never queues archived repositories", () => {
    const plan = planQueueBatch({
      unseen: catalog(),
      signals: rustFan(),
      followedTopics: new Set(),
      caps: { batch: 10 },
    });
    expect(plan.items.map((item) => item.repoId)).not.toContain(8);
  });

  it("protects exploration seeds from the score cut", () => {
    const plan = planQueueBatch({
      unseen: catalog(),
      signals: rustFan(),
      followedTopics: new Set(),
      caps: { batch: 6, pool: 3, exploreSeeds: 2 },
    });
    const ids = plan.items.map((item) => item.repoId);
    // Novel low-scoring repos bypass the tiny exploitation pool via seeds.
    expect(ids).toContain(4);
    const novel = plan.items.find((item) => item.repoId === 4);
    expect(novel?.sources).toContain("exploration");
  });

  it("lifts semantically on-interest repos once vectors exist", () => {
    const base = planQueueBatch({
      unseen: catalog(),
      signals: rustFan(),
      followedTopics: new Set(["physics"]),
      caps: { batch: 4, pool: 50, exploreSeeds: 0 },
    });
    const sem = planQueueBatch({
      unseen: catalog(),
      signals: rustFan(),
      followedTopics: new Set(["physics"]),
      clusters: clusters(),
      vectorsByRepo: VECTORS,
      caps: { batch: 4, pool: 50, exploreSeeds: 0 },
    });
    const rankOf = (items: { repoId: number }[], id: number) =>
      items.findIndex((item) => item.repoId === id);
    // Physics repo 7 has an explicit-topic boost in both; the Rust repos
    // gain semantic similarity only in the second plan.
    expect(rankOf(sem.items, 3)).toBeLessThanOrEqual(rankOf(base.items, 3));
    expect(sem.stats.semanticCoverage).toBeGreaterThan(0);
  });

  it("penalises candidates near the negative region", () => {
    const plain = planQueueBatch({
      unseen: catalog(),
      signals: rustFan(),
      followedTopics: new Set(["physics"]),
      clusters: clusters(),
      vectorsByRepo: VECTORS,
      caps: { batch: 10, pool: 50, exploreSeeds: 0 },
    });
    const averse = planQueueBatch({
      unseen: catalog(),
      signals: rustFan(),
      followedTopics: new Set(["physics"]),
      clusters: clusters(),
      vectorsByRepo: VECTORS,
      negativeVectors: [RUST_A, RUST_B],
      caps: { batch: 10, pool: 50, exploreSeeds: 0 },
    });
    const scoreOf = (items: { repoId: number; score: number }[], id: number) =>
      items.find((item) => item.repoId === id)?.score ?? NaN;
    // Rust repos sit inside the negative region; the physics repo does not.
    expect(scoreOf(averse.items, 1)).toBeLessThan(scoreOf(plain.items, 1));
    expect(scoreOf(plain.items, 1) - scoreOf(averse.items, 1)).toBeGreaterThan(
      0.5,
    );
    expect(
      Math.abs(scoreOf(averse.items, 7) - scoreOf(plain.items, 7)),
    ).toBeLessThan(0.15);
  });

  it("uses semantic rerank at full vector coverage, facet rerank otherwise", () => {
    const full = planQueueBatch({
      unseen: catalog(),
      signals: rustFan(),
      followedTopics: new Set(),
      clusters: clusters(),
      vectorsByRepo: VECTORS,
      caps: { batch: 6, pool: 50, exploreSeeds: 0 },
    });
    expect(full.stats.usedSemanticRerank).toBe(true);
    const partial = planQueueBatch({
      unseen: catalog(),
      signals: rustFan(),
      followedTopics: new Set(),
      clusters: clusters(),
      vectorsByRepo: new Map([[1, RUST_A]]),
      caps: { batch: 6, pool: 50, exploreSeeds: 0 },
    });
    expect(partial.stats.usedSemanticRerank).toBe(false);
  });

  it("keeps vector-retrieval provenance on extras", () => {
    const plan = planQueueBatch({
      unseen: catalog(),
      signals: rustFan(),
      followedTopics: new Set(),
      clusters: clusters(),
      vectorsByRepo: VECTORS,
      extraCandidates: [{ repo: catalog()[6], sources: ["semantic"] }],
      caps: { batch: 6, pool: 50, exploreSeeds: 0 },
    });
    const physics = plan.items.find((item) => item.repoId === 7);
    expect(physics?.sources).toContain("semantic");
    expect(plan.stats.candidateBySource["semantic"]).toBeGreaterThan(0);
  });

  it("is deterministic and handles empty input", () => {
    const input = {
      unseen: catalog(),
      signals: rustFan(),
      followedTopics: new Set<string>(),
      clusters: clusters(),
      vectorsByRepo: VECTORS,
      caps: { batch: 6 },
    };
    const first = planQueueBatch(input).items.map((item) => item.repoId);
    const second = planQueueBatch(input).items.map((item) => item.repoId);
    expect(first).toEqual(second);
    const empty = planQueueBatch({
      unseen: [],
      signals: rustFan(),
      followedTopics: new Set(),
    });
    expect(empty.items).toEqual([]);
    expect(empty.stats.candidateCount).toBe(0);
  });
});
