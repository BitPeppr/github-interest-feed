import { describe, expect, it } from "vitest";
import {
  ACCELERATION_MAX_CONTRIBUTION,
  DEFAULT_WEIGHTS,
  QUALITY_LOG_CAP,
  QUALITY_MAX_CONTRIBUTION,
  VELOCITY_MAX_CONTRIBUTION,
} from "../constants";
import {
  extractFeatures,
  freshness,
  scoreFeatures,
  scoreProject,
} from "../scoring";
import { emptySignals } from "../signals";
import { repo, saturatedSignals } from "./fixtures";

const NOW = 1_750_000_000_000;

describe("freshness", () => {
  it("is monotonic in recency and zero without a push date", () => {
    const day = 86_400_000;
    expect(freshness(NOW, NOW)).toBe(1);
    expect(freshness(NOW - 45 * day, NOW)).toBeCloseTo(0.5);
    expect(freshness(NOW - 10 * day, NOW)).toBeGreaterThan(
      freshness(NOW - 40 * day, NOW),
    );
    expect(freshness(undefined, NOW)).toBe(0);
  });
});

describe("scoreProject", () => {
  it("ranks archived repositories below everything", () => {
    const signals = emptySignals(NOW);
    const archived = repo({ repoId: 1, archived: true, stars: 500_000 });
    const normal = repo({ repoId: 2, stars: 3 });
    const a = scoreProject(archived, signals);
    const b = scoreProject(normal, signals);
    expect(a.score).toBe(Number.NEGATIVE_INFINITY);
    expect(b.score).toBeGreaterThan(Number.NEGATIVE_INFINITY);
  });

  it("penalises strongly disliked owners", () => {
    const clean = emptySignals(NOW);
    const hostile = emptySignals(NOW);
    hostile.ownerDislike.set("acme", -1.6);
    const target = repo({ repoId: 1, owner: "acme", stars: 100 });
    expect(scoreProject(target, hostile).score).toBeLessThan(
      scoreProject(target, clean).score - 1,
    );
  });

  it("bounds popularity: the quality feature cannot exceed its cap", () => {
    const signals = emptySignals(NOW);
    const mega = extractFeatures(
      repo({ repoId: 1, stars: 1_000_000 }),
      signals,
    );
    const tiny = extractFeatures(repo({ repoId: 2, stars: 5 }), signals);
    expect(mega.quality).toBeLessThanOrEqual(QUALITY_LOG_CAP);
    const { score: big } = scoreFeatures(
      { ...tiny, quality: mega.quality },
      { ...DEFAULT_WEIGHTS, quality: 1 },
    );
    const { score: small } = scoreFeatures(
      { ...tiny, quality: tiny.quality },
      { ...DEFAULT_WEIGHTS, quality: 1 },
    );
    expect(big - small).toBeLessThanOrEqual(QUALITY_LOG_CAP);
  });

  it("does not let raw popularity beat genuine affinity", () => {
    const signals = saturatedSignals(NOW, ["rust", "Rust", "burnt"]);
    signals.topicAffinity.set("rust", 3);
    signals.languageAffinity.set("Rust", 2);
    signals.ownerAffinity.set("burnt", 1);
    const beloved = repo({
      repoId: 1,
      stars: 60,
      topics: ["rust"],
      language: "Rust",
      owner: "burnt",
    });
    const famous = repo({
      repoId: 2,
      stars: 250_000,
      topics: ["enterprise-forms"],
      language: "COBOL",
      owner: "stranger",
    });
    // Saturate the famous repo's facets too, so exploration cannot save it.
    for (const topic of famous.topics) signals.topicSeen.set(topic, 1000);
    signals.languageSeen.set("COBOL", 1000);
    signals.ownerSeen.set("stranger", 1000);
    expect(scoreProject(beloved, signals).score).toBeGreaterThan(
      scoreProject(famous, signals).score,
    );
  });

  it("raises score with positive semantic similarity when enabled", () => {
    const signals = emptySignals(NOW);
    const target = repo({ repoId: 1 });
    const weights = { ...DEFAULT_WEIGHTS, semanticBest: 2 };
    const cold = scoreProject(target, signals, weights);
    const warm = scoreProject(target, signals, weights, {
      best: 0.8,
      weighted: 0.6,
    });
    expect(warm.score).toBeGreaterThan(cold.score);
    expect(warm.features.semanticBest).toBe(0.8);
  });

  it("lowers score with negative semantic similarity when enabled", () => {
    const signals = emptySignals(NOW);
    const target = repo({ repoId: 1 });
    // negativeSimilarity is a magnitude with a negative weight.
    const weights = { ...DEFAULT_WEIGHTS, negativeSimilarity: -1.5 };
    const neutral = scoreProject(target, signals, weights);
    const averse = scoreProject(target, signals, weights, { negative: 0.7 });
    expect(averse.score).toBeLessThan(neutral.score);
  });

  it("ignores repository identity: identical repos score identically", () => {
    const signals = emptySignals(NOW);
    const a = scoreProject(repo({ repoId: 7, stars: 1234 }), signals);
    const b = scoreProject(repo({ repoId: 999983, stars: 1234 }), signals);
    expect(a.score).toBe(b.score);
  });
});

describe("star growth", () => {
  it("lets a fast riser outrank a slower one at equal star count", () => {
    const signals = emptySignals(NOW);
    const fast = scoreProject(repo({ repoId: 1, starGrowth7d: 900 }), signals);
    const slow = scoreProject(repo({ repoId: 2, starGrowth7d: 5 }), signals);
    expect(fast.score).toBeGreaterThan(slow.score);
  });

  it("prefers a smaller fast riser over a larger already-famous project", () => {
    // The point of a discovery feed: "before it was big" beats "already famous".
    const signals = emptySignals(NOW);
    const riser = repo({ repoId: 1, stars: 400, starGrowth7d: 800 });
    const famous = repo({ repoId: 2, stars: 120_000 });
    expect(scoreProject(riser, signals).score).toBeGreaterThan(
      scoreProject(famous, signals).score,
    );
  });

  it("ignores absent, zero and negative growth", () => {
    const signals = emptySignals(NOW);
    const base = scoreProject(repo({ repoId: 1 }), signals).score;
    for (const measure of [undefined, 0, -500]) {
      const measured = scoreProject(
        repo({ repoId: 1, starGrowth7d: measure, starAccel: measure }),
        signals,
      );
      expect(measured.score).toBe(base);
      expect(measured.features.velocity).toBe(0);
      expect(measured.features.acceleration).toBe(0);
    }
  });

  it("bounds each growth term at its contribution ceiling", () => {
    const signals = emptySignals(NOW);
    // Absurd growth must not buy more than the stated ceiling.
    const wild = scoreProject(
      repo({ repoId: 1, starGrowth7d: 1e9, starAccel: 1e9 }),
      signals,
    );
    expect(wild.features.velocity * DEFAULT_WEIGHTS.velocity).toBeCloseTo(
      VELOCITY_MAX_CONTRIBUTION,
    );
    expect(
      wild.features.acceleration * DEFAULT_WEIGHTS.acceleration,
    ).toBeCloseTo(ACCELERATION_MAX_CONTRIBUTION);
  });

  it("caps popularity so mega-stars cannot dominate the window", () => {
    const signals = emptySignals(NOW);
    const huge = scoreProject(repo({ repoId: 1, stars: 1e9 }), signals);
    expect(huge.features.quality).toBe(QUALITY_LOG_CAP);
    expect(huge.features.quality * DEFAULT_WEIGHTS.quality).toBeCloseTo(
      QUALITY_MAX_CONTRIBUTION,
    );
  });
});
