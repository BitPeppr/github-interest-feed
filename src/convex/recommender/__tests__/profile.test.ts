import { describe, expect, it } from "vitest";
import {
  affinityCredit,
  applyImpressions,
  applyTransition,
  emptyProfile,
  fromStorable,
  profileMatchesSignals,
  toStorable,
} from "../profile";
import { rated, repo } from "./fixtures";

const FACETS = { topics: ["rust", "cli"], language: "Rust", owner: "burnt" };
const NOW = 1_750_000_000_000;

describe("affinityCredit", () => {
  it("weighs a saved 5/5 above a passive save above a bare view", () => {
    const ratedSaved = affinityCredit({ value: 5, saved: true });
    const ratedOnly = affinityCredit({ value: 5 });
    const savedOnly = affinityCredit({ saved: true });
    const bare = affinityCredit({});
    expect(ratedSaved).toBeGreaterThan(ratedOnly);
    expect(ratedOnly).toBeGreaterThan(savedOnly);
    expect(savedOnly).toBeGreaterThan(bare);
    expect(bare).toBe(0);
  });

  it("gives neutral and negative verdicts no affinity credit", () => {
    expect(affinityCredit({ value: 3, saved: true })).toBe(0);
    expect(affinityCredit({ value: 1, saved: true })).toBe(0);
  });

  it("caps open credit so click spam cannot stack affinity", () => {
    expect(affinityCredit({ githubOpens: 2 })).toBe(
      affinityCredit({ githubOpens: 50 }),
    );
    expect(affinityCredit({ githubOpens: 2 })).toBeGreaterThan(
      affinityCredit({ githubOpens: 1 }),
    );
  });
});

describe("applyTransition", () => {
  it("counts a new impression and a first rating", () => {
    const profile = emptyProfile();
    const { tasteChanged } = applyTransition(
      profile,
      null,
      { value: 5 },
      FACETS,
      true,
    );
    expect(tasteChanged).toBe(true);
    expect(profile.impressionCount).toBe(1);
    expect(profile.ratingCount).toBe(1);
    expect(profile.positiveCount).toBe(1);
    expect(profile.topicAffinity).toEqual({ rust: 1, cli: 1 });
    expect(profile.feedVersion).toBe(1);
  });

  it("moves counts when a rating flips from positive to negative", () => {
    const profile = emptyProfile();
    applyTransition(profile, null, { value: 5 }, FACETS, true);
    applyTransition(profile, { value: 5 }, { value: 1 }, FACETS, false);
    expect(profile.positiveCount).toBe(0);
    expect(profile.negativeCount).toBe(1);
    expect(profile.ratingCount).toBe(1);
    expect(profile.impressionCount).toBe(1);
    expect(profile.topicAffinity).toEqual({});
  });

  it("adds and removes save credit symmetrically", () => {
    const profile = emptyProfile();
    applyTransition(profile, null, { saved: true }, FACETS, true);
    expect(profile.savedCount).toBe(1);
    expect(profile.topicAffinity["rust"]).toBeCloseTo(0.75);
    applyTransition(profile, { saved: true }, { saved: false }, FACETS, false);
    expect(profile.savedCount).toBe(0);
    expect(profile.topicAffinity).toEqual({});
  });

  it("credits opens only while under the cap", () => {
    const profile = emptyProfile();
    applyTransition(profile, null, { githubOpens: 1 }, FACETS, true);
    const afterFirst = profile.topicAffinity["rust"] ?? 0;
    applyTransition(
      profile,
      { githubOpens: 1 },
      { githubOpens: 2 },
      FACETS,
      false,
    );
    const afterSecond = profile.topicAffinity["rust"] ?? 0;
    applyTransition(
      profile,
      { githubOpens: 2 },
      { githubOpens: 9 },
      FACETS,
      false,
    );
    expect(afterSecond).toBeGreaterThan(afterFirst);
    expect(profile.topicAffinity["rust"]).toBeCloseTo(afterSecond);
    expect(profile.githubOpenCount).toBe(9);
  });

  it("does not bump the feed version for neutral exposure", () => {
    const profile = emptyProfile();
    const { tasteChanged } = applyTransition(profile, null, {}, FACETS, true);
    expect(tasteChanged).toBe(false);
    expect(profile.feedVersion).toBe(0);
    expect(profile.impressionCount).toBe(1);
  });
});

describe("applyImpressions", () => {
  it("batches many impressions into one count bump", () => {
    const profile = emptyProfile();
    applyImpressions(profile, 14);
    expect(profile.impressionCount).toBe(14);
    expect(profile.feedVersion).toBe(0);
  });
});

describe("profile parity with buildSignals", () => {
  function replay(rows: Parameters<typeof profileMatchesSignals>[1]) {
    const profile = emptyProfile();
    for (const row of rows) {
      const next = {
        value: row.value,
        saved: row.saved,
        hidden: row.hidden,
        githubOpens: row.githubOpens,
        readmeOpens: row.readmeOpens,
      };
      // Fresh profile: every row is new, so transitions start from null.
      applyTransition(
        profile,
        null,
        next,
        {
          topics: row.repo.topics,
          language: row.repo.language,
          owner: row.repo.owner,
        },
        true,
      );
    }
    return profile;
  }

  it("matches buildSignals affinity on a mixed history", () => {
    const rows = [
      rated(1, 5, { topics: ["rust"], language: "Rust", owner: "burnt" }),
      rated(2, 4, { topics: ["rust", "cli"], language: "Rust", owner: "rat" }),
      rated(3, 2, { topics: ["php"], language: "PHP", owner: "acme" }),
      rated(4, 3, { topics: ["go"], language: "Go", owner: "someone" }),
      {
        repo: repo({
          repoId: 5,
          topics: ["zig"],
          language: "Zig",
          owner: "ziggy",
        }),
        saved: true,
      },
      {
        repo: repo({
          repoId: 6,
          topics: ["tui"],
          language: "Python",
          owner: "rich",
        }),
        githubOpens: 3,
        readmeOpens: 1,
      },
      {
        repo: repo({
          repoId: 7,
          topics: ["rust"],
          language: "Rust",
          owner: "tokio",
        }),
        value: 5,
        saved: true,
        githubOpens: 2,
      },
      {
        repo: repo({
          repoId: 8,
          topics: ["elm"],
          language: "Elm",
          owner: "evan",
        }),
        hidden: true,
      },
    ];
    const profile = replay(rows);
    expect(profileMatchesSignals(profile, rows, NOW)).toBe(true);
    // Sanity: the replay actually measured something.
    expect(profile.topicAffinity["rust"]).toBeGreaterThan(3);
    expect(profile.positiveCount).toBe(3);
    expect(profile.negativeCount).toBe(1);
    expect(profile.savedCount).toBe(2);
    expect(profile.hiddenCount).toBe(1);
  });

  it("survives a storable round-trip without losing affinity", () => {
    const profile = emptyProfile();
    applyTransition(profile, null, { value: 5, saved: true }, FACETS, true);
    const restored = {
      ...emptyProfile(),
      ...fromStorable(toStorable(profile)),
    };
    expect(restored.topicAffinity).toEqual(profile.topicAffinity);
    expect(restored.languageAffinity).toEqual(profile.languageAffinity);
    expect(restored.ownerAffinity).toEqual(profile.ownerAffinity);
  });
});
