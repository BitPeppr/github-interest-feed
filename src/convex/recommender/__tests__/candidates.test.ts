import { describe, expect, it } from "vitest";
import { assembleFeed, dedupe, tagSources } from "../candidates";
import { EXPLORE_COOL_FLOOR, EXPLORE_COOL_IMPRESSIONS } from "../constants";
import { buildSignals } from "../signals";
import { emptySignals } from "../signals";
import { scoreProject } from "../scoring";
import { rated, repo } from "./fixtures";

const NOW = 1_750_000_000_000;

function rustFan(): ReturnType<typeof buildSignals> {
  return buildSignals(NOW, [
    rated(900, 5, {
      topics: ["rust", "cli"],
      language: "Rust",
      owner: "burnt",
    }),
    rated(901, 5, { topics: ["rust", "tui"], language: "Rust", owner: "rat" }),
    rated(902, 4, { topics: ["rust"], language: "Rust", owner: "tokio" }),
  ]);
}

describe("assembleFeed", () => {
  it("filters archived, touched and excluded repositories", () => {
    const signals = emptySignals(NOW);
    const catalog = [
      repo({ repoId: 1, archived: true, stars: 999_999 }),
      repo({ repoId: 2 }),
      repo({ repoId: 3 }),
      repo({ repoId: 4 }),
    ];
    const { window, unseenCount } = assembleFeed(
      catalog,
      signals,
      new Set([2]),
      new Set([3]),
      { windowSize: 10, exploreSlots: 0 },
    );
    expect(window.map((c) => c.repo.repoId)).toEqual([4]);
    expect(unseenCount).toBe(1);
  });

  it("surfaces underexplored projects even when they miss the scored pool", () => {
    const signals = rustFan();
    // Six high-affinity Rust projects dominate the exploitation pool, plus
    // two low-scoring but completely novel ones (new language + new owner).
    const rust = Array.from({ length: 6 }, (_, i) =>
      repo({
        repoId: 10 + i,
        stars: 5000,
        topics: ["rust", "cli"],
        language: "Rust",
        owner: `rust-owner-${i}`,
      }),
    );
    const novel = [
      repo({
        repoId: 100,
        stars: 30,
        topics: ["sonification"],
        language: "SuperCollider",
        owner: "unheard",
      }),
      repo({
        repoId: 101,
        stars: 40,
        topics: ["paper-circuits"],
        language: "Forth",
        owner: "strange",
      }),
    ];
    const { window } = assembleFeed(
      [...rust, ...novel],
      signals,
      new Set(),
      new Set(),
      {
        poolSize: 5,
        exploreSlots: 2,
        windowSize: 6,
      },
    );
    const ids = window.map((c) => c.repo.repoId);
    expect(ids).toContain(100);
    expect(ids).toContain(101);
    const sources = window
      .filter((c) => c.repo.repoId >= 100)
      .flatMap((c) => c.sources);
    expect(sources).toContain("exploration");
  });

  it("cools the exploration slice as impressions accumulate", () => {
    // A catalog of entirely novel projects, so exploration always has
    // candidates and its slot count is the only thing that moves.
    const catalog = Array.from({ length: 40 }, (_, i) =>
      repo({
        repoId: 500 + i,
        stars: 10,
        topics: [`topic-${i}`],
        language: `Lang-${i}`,
        owner: `owner-${i}`,
      }),
    );
    const exploresAt = (impressions: number) => {
      const signals = emptySignals(NOW);
      signals.totalImpressions = impressions;
      const { window } = assembleFeed(catalog, signals, new Set(), new Set(), {
        windowSize: 12,
      });
      return window.filter((c) => c.sources.includes("exploration")).length;
    };

    const cold = exploresAt(0);
    const warm = exploresAt(EXPLORE_COOL_IMPRESSIONS);
    const saturated = exploresAt(100_000);

    // Early on the feed is mostly discovery; later it leans on what it learned.
    expect(cold).toBeGreaterThan(warm);
    // Cooling floors at EXPLORE_COOL_FLOOR of the nominal third-of-a-window,
    // so exploration is damped but never switched off.
    expect(warm).toBe(Math.floor((12 / 3) * EXPLORE_COOL_FLOOR));
    expect(saturated).toBe(warm);
  });

  it("never repeats a repository inside one window", () => {
    const signals = emptySignals(NOW);
    const catalog = Array.from({ length: 30 }, (_, i) =>
      repo({ repoId: i + 1 }),
    );
    const { window } = assembleFeed(catalog, signals, new Set(), new Set(), {
      windowSize: 24,
    });
    const ids = window.map((c) => c.repo.repoId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic: the same inputs always produce the same order", () => {
    const signals = rustFan();
    const catalog = Array.from({ length: 60 }, (_, i) =>
      repo({
        repoId: i + 1,
        stars: (i * 37) % 9000,
        topics: i % 2 === 0 ? ["rust"] : ["weird-topic"],
        language: i % 3 === 0 ? "Rust" : "Zig",
        owner: `owner-${i % 7}`,
      }),
    );
    const first = assembleFeed(
      catalog,
      signals,
      new Set(),
      new Set(),
    ).window.map((c) => c.repo.repoId);
    const second = assembleFeed(
      catalog,
      signals,
      new Set(),
      new Set(),
    ).window.map((c) => c.repo.repoId);
    expect(first).toEqual(second);
  });

  it("breaks exact score ties by ascending repository id", () => {
    const signals = emptySignals(NOW);
    const catalog = [
      repo({ repoId: 50, stars: 100, topics: ["x"] }),
      repo({ repoId: 3, stars: 100, topics: ["x"] }),
    ];
    const { window } = assembleFeed(catalog, signals, new Set(), new Set(), {
      windowSize: 2,
      exploreSlots: 0,
    });
    expect(window.map((c) => c.repo.repoId)).toEqual([3, 50]);
  });

  it("keeps every window entry annotated with provenance", () => {
    const signals = rustFan();
    const catalog = Array.from({ length: 12 }, (_, i) =>
      repo({
        repoId: i + 1,
        topics: ["rust"],
        language: "Rust",
        owner: `o-${i}`,
      }),
    );
    const { window } = assembleFeed(catalog, signals, new Set(), new Set(), {
      windowSize: 8,
    });
    for (const candidate of window) {
      expect(candidate.sources.length).toBeGreaterThan(0);
      expect(candidate.features).toBeDefined();
      expect(candidate.parts.length).toBeGreaterThan(0);
    }
  });
});

describe("dedupe", () => {
  it("unions provenance when two generators surface the same repo", () => {
    const signals = emptySignals(NOW);
    const target = repo({ repoId: 1 });
    const ranked = scoreProject(target, signals);
    const a = {
      repo: target,
      score: ranked.score,
      explore: 0,
      facets: new Set<string>(),
      sources: ["ranked" as const],
      features: ranked.features,
      parts: ranked.parts,
    };
    const b = {
      ...a,
      score: ranked.score - 2,
      sources: ["exploration" as const],
    };
    const merged = dedupe([a, b]);
    expect(merged).toHaveLength(1);
    expect(new Set(merged[0].sources)).toEqual(
      new Set(["ranked", "exploration"]),
    );
    expect(merged[0].score).toBe(ranked.score);
  });
});

describe("tagSources", () => {
  it("tags fresh, affinity and long-tail provenance", () => {
    const signals = buildSignals(NOW, [
      rated(900, 5, { topics: ["rust"], language: "Rust", owner: "burnt" }),
    ]);
    const fresh = repo({
      repoId: 1,
      pushedAt: NOW - 2 * 86_400_000,
      topics: ["rust"],
      language: "Rust",
      owner: "burnt",
      stars: 50,
    });
    expect(tagSources(fresh, signals)).toEqual(
      expect.arrayContaining(["ranked", "fresh", "topic", "long-tail"]),
    );
    const stale = repo({
      repoId: 2,
      pushedAt: NOW - 400 * 86_400_000,
      stars: 90_000,
    });
    expect(tagSources(stale, signals)).not.toContain("fresh");
    expect(tagSources(stale, signals)).not.toContain("long-tail");
  });
});
