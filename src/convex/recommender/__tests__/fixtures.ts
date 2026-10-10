/**
 * Deterministic fixtures for recommender unit tests.
 */
import type { RatedRepo, RepoSnapshot, Signals } from "../types";
import { emptySignals } from "../signals";

export function repo(
  overrides: Partial<RepoSnapshot> & { repoId: number },
): RepoSnapshot {
  return {
    fullName: `owner-${overrides.repoId}/repo-${overrides.repoId}`,
    owner: `owner-${overrides.repoId}`,
    name: `repo-${overrides.repoId}`,
    stars: 100,
    forks: 10,
    openIssues: 2,
    topics: [],
    archived: false,
    discoveredVia: ["test"],
    ...overrides,
  };
}

export function rated(
  repoId: number,
  value: number | undefined,
  overrides: Partial<RepoSnapshot> = {},
  extra: Partial<RatedRepo> = {},
): RatedRepo {
  return {
    repo: repo({ repoId, ...overrides }),
    value,
    ...extra,
  };
}

/** Signals with everything seen often: optimism terms near zero. */
export function saturatedSignals(now: number, facets: string[]): Signals {
  const signals = emptySignals(now);
  signals.totalImpressions = 10_000;
  for (const facet of facets) {
    signals.topicSeen.set(facet, 1000);
    signals.languageSeen.set(facet, 1000);
    signals.ownerSeen.set(facet, 1000);
  }
  return signals;
}
