import { describe, expect, it } from "vitest";
import { buildSignals } from "../signals";
import { rated, repo } from "./fixtures";

const NOW = 1_750_000_000_000;

describe("buildSignals", () => {
  it("turns 4-5 ratings into topic, language and owner affinity", () => {
    const signals = buildSignals(NOW, [
      rated(1, 5, {
        topics: ["rust", "cli"],
        language: "Rust",
        owner: "burnt",
      }),
      rated(2, 4, { topics: ["rust"], language: "Rust", owner: "other" }),
    ]);
    expect(signals.topicAffinity.get("rust")).toBe(2);
    expect(signals.topicAffinity.get("cli")).toBe(1);
    expect(signals.languageAffinity.get("Rust")).toBe(2);
    expect(signals.ownerAffinity.get("burnt")).toBe(1);
    expect(signals.topicDislike.size).toBe(0);
  });

  it("turns hides and 1-2 ratings into dislikes, hides weighing more", () => {
    const signals = buildSignals(NOW, [
      rated(1, 1, { topics: ["php"], language: "PHP", owner: "acme" }),
      {
        repo: repo({
          repoId: 2,
          topics: ["php"],
          language: "PHP",
          owner: "acme",
        }),
        hidden: true,
      },
    ]);
    // A hide (-0.8) dominates a low rating (-0.48) via strongest-dislike-wins.
    expect(signals.topicDislike.get("php")).toBeCloseTo(-0.8);
    expect(signals.languageDislike.get("PHP")).toBeCloseTo(-1);
    expect(signals.ownerDislike.get("acme")).toBeCloseTo(-1.6);
  });

  it("keeps the strongest dislike when negative feedback repeats", () => {
    const signals = buildSignals(NOW, [
      rated(1, 1, { topics: ["php"] }),
      rated(2, 2, { topics: ["php"] }),
      {
        repo: repo({ repoId: 3, topics: ["php"] }),
        value: 2,
      },
    ]);
    expect(signals.topicDislike.get("php")).toBeCloseTo(-0.48);
  });

  it("treats a 3-star rating as exposure without affinity or dislike", () => {
    const signals = buildSignals(NOW, [
      rated(1, 3, { topics: ["go"], language: "Go", owner: "someone" }),
    ]);
    expect(signals.totalImpressions).toBe(1);
    expect(signals.topicSeen.get("go")).toBe(1);
    expect(signals.topicAffinity.size).toBe(0);
    expect(signals.topicDislike.size).toBe(0);
    expect(signals.languageDislike.size).toBe(0);
  });

  it("counts every row as one impression, including bare views", () => {
    const signals = buildSignals(NOW, [
      { repo: repo({ repoId: 1, topics: ["a"] }) },
      rated(2, 5, { topics: ["b"] }),
    ]);
    expect(signals.totalImpressions).toBe(2);
    expect(signals.topicSeen.get("a")).toBe(1);
    expect(signals.topicSeen.get("b")).toBe(1);
  });

  it("records saves as behavioural evidence without forcing affinity", () => {
    const signals = buildSignals(NOW, [
      { repo: repo({ repoId: 1, topics: ["zig"] }), saved: true },
    ]);
    expect(signals.totalImpressions).toBe(1);
    expect(signals.topicSeen.get("zig")).toBe(1);
  });

  it("weighs a saved 5/5 above a bare 5/5 above a passive save", () => {
    const ratedSaved = buildSignals(NOW, [
      {
        repo: repo({ repoId: 1, topics: ["zig"] }),
        value: 5,
        saved: true,
      },
    ]);
    const ratedOnly = buildSignals(NOW, [rated(1, 5, { topics: ["zig"] })]);
    const savedOnly = buildSignals(NOW, [
      { repo: repo({ repoId: 1, topics: ["zig"] }), saved: true },
    ]);
    const zig = (s: ReturnType<typeof buildSignals>) =>
      s.topicAffinity.get("zig") ?? 0;
    expect(zig(ratedSaved)).toBeGreaterThan(zig(ratedOnly));
    expect(zig(ratedOnly)).toBeGreaterThan(zig(savedOnly));
    expect(zig(savedOnly)).toBeGreaterThan(0);
  });

  it("credits bounded opens but ignores dwell for affinity", () => {
    const signals = buildSignals(NOW, [
      {
        repo: repo({ repoId: 1, topics: ["zig"] }),
        githubOpens: 10,
        readmeOpens: 10,
        dwellMs: 3_600_000,
      },
    ]);
    // 2 counted GitHub opens * 0.5 + 2 counted README opens * 0.25 = 1.5.
    expect(signals.topicAffinity.get("zig")).toBeCloseTo(1.5);
  });
});
