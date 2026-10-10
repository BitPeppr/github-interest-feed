import { describe, expect, it } from "vitest";
import { tagSources } from "../candidates";
import { explainCandidate } from "../explain";
import { buildSignals } from "../signals";
import { scoreProject } from "../scoring";
import { emptySignals } from "../signals";
import { rated, repo } from "./fixtures";

const NOW = 1_750_000_000_000;

function explained(
  overrides: Parameters<typeof repo>[0],
  signals: ReturnType<typeof buildSignals>,
  followed: Set<string>,
) {
  const snapshot = repo(overrides);
  const { features } = scoreProject(snapshot, signals, undefined, {
    followedTopics: followed,
  });
  const sources = tagSources(snapshot, signals, followed);
  return {
    reasons: explainCandidate({
      candidate: {
        repo: snapshot,
        score: 0,
        explore: 0,
        facets: new Set<string>(),
        sources,
        features,
        parts: [],
      },
      signals,
      followedTopics: followed,
    }),
    sources,
  };
}

describe("explainCandidate", () => {
  it("leads with an explicitly followed topic", () => {
    const { reasons } = explained(
      { repoId: 1, topics: ["rust", "cli"] },
      emptySignals(NOW),
      new Set(["rust"]),
    );
    expect(reasons[0]).toBe("Because you follow rust");
  });

  it("names the learned topic affinity when nothing is followed", () => {
    const signals = buildSignals(NOW, [
      rated(900, 5, { topics: ["rust"], language: "Rust", owner: "burnt" }),
    ]);
    const { reasons } = explained(
      { repoId: 1, topics: ["rust", "cli"], language: "Go", owner: "stranger" },
      signals,
      new Set(),
    );
    expect(reasons[0]).toBe("Similar to rust projects you rated highly");
  });

  it("falls back to language affinity, then exploration", () => {
    const signals = buildSignals(NOW, [
      rated(900, 5, { topics: ["other"], language: "Rust", owner: "burnt" }),
    ]);
    const lang = explained(
      {
        repoId: 1,
        topics: ["fresh-topic"],
        language: "Rust",
        owner: "stranger",
      },
      signals,
      new Set(),
    );
    expect(lang.reasons[0]).toBe("Matches your interest in Rust");

    // Exploration provenance comes from the assembly path, not the tagger:
    // pass it through exactly as assembleFeed would.
    const snapshot = repo({
      repoId: 2,
      topics: ["sonification"],
      language: "SuperCollider",
      owner: "unheard",
    });
    const { features } = scoreProject(snapshot, signals);
    const reasons = explainCandidate({
      candidate: {
        repo: snapshot,
        score: 0,
        explore: 3,
        facets: new Set<string>(),
        sources: ["ranked", "exploration"],
        features,
        parts: [],
      },
      signals,
      followedTopics: new Set(),
    });
    expect(reasons[0]).toBe("Exploration pick outside your usual areas");
  });

  it("never returns more than two reasons and never an empty list", () => {
    const signals = buildSignals(NOW, [
      rated(900, 5, { topics: ["rust"], language: "Rust", owner: "burnt" }),
    ]);
    const { reasons } = explained(
      {
        repoId: 1,
        topics: ["rust"],
        language: "Rust",
        owner: "burnt",
        pushedAt: NOW - 1000,
      },
      signals,
      new Set(["rust"]),
    );
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.length).toBeLessThanOrEqual(2);

    const cold = explained(
      { repoId: 2, topics: ["x"] },
      emptySignals(NOW),
      new Set(),
    );
    expect(cold.reasons.length).toBe(1);
  });

  it("only claims exploration when the candidate actually came from there", () => {
    const signals = emptySignals(NOW);
    const { reasons, sources } = explained(
      {
        repoId: 1,
        topics: ["well-known"],
        language: "TypeScript",
        owner: "vercel",
      },
      signals,
      new Set(),
    );
    // A familiar-facet repo is not an exploration pick; the reason must not lie.
    if (!sources.includes("exploration")) {
      expect(reasons.join(" ")).not.toMatch(/Exploration pick/);
    }
  });
});
