import { describe, expect, it } from "vitest";
import { selectExploration } from "../exploration";
import { emptySignals } from "../signals";
import { buildSignals } from "../signals";
import { rated, repo } from "./fixtures";

const NOW = 1_750_000_000_000;

describe("selectExploration", () => {
  it("prefers repositories with unseen facets over familiar ones", () => {
    const signals = buildSignals(NOW, [
      rated(900, 5, { topics: ["rust"], language: "Rust", owner: "burnt" }),
      rated(901, 4, { topics: ["rust"], language: "Rust", owner: "burnt" }),
    ]);
    const familiar = repo({
      repoId: 1,
      topics: ["rust"],
      language: "Rust",
      owner: "burnt",
    });
    const novel = repo({
      repoId: 2,
      topics: ["sonification"],
      language: "SuperCollider",
      owner: "unheard",
    });
    const picks = selectExploration([familiar, novel], signals, 1);
    expect(picks.map((p) => p.repo.repoId)).toEqual([2]);
  });

  it("returns nothing when every facet is already well explored", () => {
    const signals = buildSignals(NOW, [
      rated(900, 5, { topics: ["rust"], language: "Rust", owner: "burnt" }),
    ]);
    const seen = repo({
      repoId: 1,
      topics: ["rust"],
      language: "Rust",
      owner: "burnt",
    });
    // Seen language + owner and a well-exposed topic drag novelty below 1.
    signals.topicSeen.set("rust", 50);
    expect(selectExploration([seen], signals, 2)).toEqual([]);
  });

  it("respects the slot budget and diversifies novel picks", () => {
    const signals = emptySignals(NOW);
    const unseen = Array.from({ length: 10 }, (_, i) =>
      repo({ repoId: i + 1, topics: [`novel-${i % 3}`], owner: `new-${i}` }),
    );
    const picks = selectExploration(unseen, signals, 2);
    expect(picks).toHaveLength(2);
  });

  it("handles empty input and zero slots", () => {
    const signals = emptySignals(NOW);
    expect(selectExploration([], signals, 3)).toEqual([]);
    expect(selectExploration([repo({ repoId: 1 })], signals, 0)).toEqual([]);
  });
});
