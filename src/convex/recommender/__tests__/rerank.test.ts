import { describe, expect, it } from "vitest";
import { interleave, selectWindow } from "../rerank";
import { facetsOf } from "../scoring";
import { repo } from "./fixtures";

function entry(repoId: number, score: number, overrides = {}) {
  const r = repo({ repoId, ...overrides });
  // `language` is passed through exactly as production callers do, so these
  // tests exercise the same decay path the feed uses.
  return {
    item: r,
    score,
    facets: facetsOf(r),
    owner: r.owner,
    language: r.language,
  };
}

/**
 * An entry whose facets share nothing with any other entry, so Jaccard
 * similarity is 0 across the pool and only score and the language multiplier
 * decide the order.
 */
function isolated(repoId: number, score: number, language: string) {
  const r = repo({ repoId, language });
  return {
    item: r,
    score,
    facets: new Set([`only-${repoId}`]),
    owner: r.owner,
    language,
  };
}

describe("selectWindow", () => {
  it("does not let near-identical projects occupy the whole window", () => {
    const pool = [
      ...Array.from({ length: 10 }, (_, i) =>
        entry(100 + i, 10 - i * 0.1, {
          owner: `clone-${i}`,
          topics: ["same", "identical"],
          language: "Rust",
        }),
      ),
      entry(1, 8.0, { owner: "div-a", topics: ["physics"], language: "Julia" }),
      entry(2, 7.9, { owner: "div-b", topics: ["music"], language: "Python" }),
      entry(3, 7.8, { owner: "div-c", topics: ["fonts"], language: "Go" }),
    ];
    const window = selectWindow(pool, 6);
    const ids = window.map((r) => r.repoId);
    expect(ids).toContain(1);
    const distinctTopics = new Set(window.flatMap((r) => r.topics));
    expect(distinctTopics.size).toBeGreaterThan(2);
    expect(window.filter((r) => r.topics.includes("same")).length).toBeLessThan(
      6,
    );
  });

  it("decays repeated owners so a second author breaks through", () => {
    const pool = [
      entry(1, 10.0, { owner: "prolific" }),
      entry(2, 9.9, { owner: "prolific" }),
      entry(3, 9.8, { owner: "prolific" }),
      entry(4, 9.5, { owner: "quiet" }),
    ];
    const window = selectWindow(pool, 3);
    const owners = window.map((r) => r.owner);
    // Second pick of the same owner is decayed below the rival author.
    expect(owners[0]).toBe("prolific");
    expect(owners[1]).toBe("quiet");
    expect(owners).toContain("prolific");
  });

  it("breaks a same-language run once the third copy is decayed below a rival", () => {
    // Facets are unique singletons, so Jaccard similarity is 0 for every pair
    // and the language multiplier is the ONLY thing separating these picks.
    // Without it the third Rust (9.8) would take the slot over Julia (9.6);
    // with it, 9.8 * 0.8 = 7.84 loses.
    const pool = [
      isolated(1, 10.0, "Rust"),
      isolated(2, 9.9, "Rust"),
      isolated(3, 9.8, "Rust"),
      isolated(4, 9.7, "Rust"),
      isolated(5, 9.6, "Julia"),
    ];
    const window = selectWindow(pool, 4);
    const languages = window.map((r) => r.language);
    // First two Rust are free, then the decayed third hands over to Julia.
    expect(languages.slice(0, 2)).toEqual(["Rust", "Rust"]);
    expect(languages[2]).toBe("Julia");
  });

  it("leaves a language run intact when the score gap is too large to decay", () => {
    // The counter is a mild multiplicative tiebreaker, not a quota. It must
    // not pull a far weaker rival into the window.
    const pool = [
      isolated(1, 10.0, "Rust"),
      isolated(2, 9.9, "Rust"),
      isolated(3, 9.8, "Rust"),
      isolated(4, 9.7, "Rust"),
      isolated(5, 5.0, "Julia"),
    ];
    const window = selectWindow(pool, 4);
    expect(window.filter((r) => r.language === "Rust")).toHaveLength(4);
  });

  it("does not decay repeats when no language is supplied", () => {
    const pool = [
      {
        item: repo({ repoId: 1 }),
        score: 10,
        facets: new Set(["t"]),
        owner: "a",
      },
      {
        item: repo({ repoId: 2 }),
        score: 9.9,
        facets: new Set(["t"]),
        owner: "b",
      },
      {
        item: repo({ repoId: 3 }),
        score: 9.8,
        facets: new Set(["t"]),
        owner: "c",
      },
    ];
    expect(selectWindow(pool, 3)).toHaveLength(3);
  });

  it("prefers higher scores when nothing overlaps", () => {
    const pool = [
      entry(1, 5, { owner: "a", topics: ["t1"] }),
      entry(2, 9, { owner: "b", topics: ["t2"] }),
      entry(3, 7, { owner: "c", topics: ["t3"] }),
    ];
    const window = selectWindow(pool, 2);
    expect(window.map((r) => r.repoId)).toEqual([2, 3]);
  });

  it("returns fewer items when the pool is exhausted", () => {
    const pool = [entry(1, 5, { owner: "a" })];
    expect(selectWindow(pool, 10)).toHaveLength(1);
  });
});

describe("interleave", () => {
  it("spreads exploration picks through the window", () => {
    const out = interleave(
      ["e1", "e2"],
      ["r1", "r2", "r3", "r4", "r5", "r6"],
      8,
    );
    expect(out[0]).toBe("e1");
    expect(out[4]).toBe("e2");
    expect(out).toHaveLength(8);
    expect(new Set(out).size).toBe(8);
  });

  it("degrades gracefully when one side is empty", () => {
    expect(interleave([], ["r1", "r2"], 2)).toEqual(["r1", "r2"]);
    expect(interleave(["e1"], [], 2)).toEqual(["e1"]);
  });
});
