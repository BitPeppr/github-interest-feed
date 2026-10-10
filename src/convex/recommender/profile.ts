/**
 * Incremental per-user taste profile.
 *
 * `buildSignals` reconstructs affinities from full history; this module keeps
 * the same affinity maps up to date one interaction at a time so hot paths
 * can read a single small document instead of replaying history. The update
 * is a pure function (`applyTransition`) with parity tests against
 * `buildSignals`.
 *
 * Scope note: only ADDITIVE affinity is maintained here. Dislike min-maps
 * ("strongest dislike wins") are not incrementally maintainable — removing a
 * dislike cannot recompute a minimum — so ranking still derives dislikes from
 * history. Dwell time is recorded for evaluation but excluded from affinity.
 */
import {
  COUNTED_OPENS_CAP,
  GITHUB_OPEN_AFFINITY,
  NEGATIVE_RATING_THRESHOLD,
  POSITIVE_RATING_THRESHOLD,
  README_OPEN_AFFINITY,
  SAVE_AFFINITY_BONUS,
  SAVE_ONLY_AFFINITY,
} from "./constants";
import { buildSignals } from "./signals";
import type { RatedRepo } from "./types";

/** Observable state of one (user, repo) rating row. */
export interface RowState {
  value?: number;
  saved?: boolean;
  hidden?: boolean;
  githubOpens?: number;
  readmeOpens?: number;
}

/** Facets of the repository the transition refers to. */
export interface TransitionFacets {
  topics: string[];
  language?: string;
  owner: string;
}

/** Incrementally maintained taste summary (plain data, DB-agnostic). */
export interface ProfileSnapshot {
  ratingCount: number;
  impressionCount: number;
  positiveCount: number;
  negativeCount: number;
  savedCount: number;
  hiddenCount: number;
  githubOpenCount: number;
  readmeOpenCount: number;
  topicAffinity: Record<string, number>;
  languageAffinity: Record<string, number>;
  ownerAffinity: Record<string, number>;
  /** Bumped whenever taste changes; the queue generator consumes it (PR4). */
  feedVersion: number;
}

export function emptyProfile(): ProfileSnapshot {
  return {
    ratingCount: 0,
    impressionCount: 0,
    positiveCount: 0,
    negativeCount: 0,
    savedCount: 0,
    hiddenCount: 0,
    githubOpenCount: 0,
    readmeOpenCount: 0,
    topicAffinity: {},
    languageAffinity: {},
    ownerAffinity: {},
    feedVersion: 0,
  };
}

type Verdict = "positive" | "neutral" | "negative" | "none";

function verdict(value: number | undefined): Verdict {
  if (value === undefined) return "none";
  if (value >= POSITIVE_RATING_THRESHOLD) return "positive";
  if (value <= NEGATIVE_RATING_THRESHOLD) return "negative";
  return "neutral";
}

/**
 * Affinity credit a row state contributes per facet — mirrors `buildSignals`
 * exactly: +1 per positive rating, fractional save/open credit, save-only
 * credit for unrated rows, nothing for neutral/negative verdicts.
 */
export function affinityCredit(state: RowState): number {
  const v = verdict(state.value);
  if (v === "positive") {
    return (
      1 +
      (state.saved === true ? SAVE_AFFINITY_BONUS : 0) +
      Math.min(state.githubOpens ?? 0, COUNTED_OPENS_CAP) *
        GITHUB_OPEN_AFFINITY +
      Math.min(state.readmeOpens ?? 0, COUNTED_OPENS_CAP) * README_OPEN_AFFINITY
    );
  }
  if (v === "none") {
    return (
      (state.saved === true ? SAVE_ONLY_AFFINITY : 0) +
      Math.min(state.githubOpens ?? 0, COUNTED_OPENS_CAP) *
        GITHUB_OPEN_AFFINITY +
      Math.min(state.readmeOpens ?? 0, COUNTED_OPENS_CAP) * README_OPEN_AFFINITY
    );
  }
  return 0;
}

function addCredit(
  map: Record<string, number>,
  keys: (string | undefined)[],
  amount: number,
): void {
  if (amount === 0) return;
  for (const key of keys) {
    if (!key) continue;
    const next = (map[key] ?? 0) + amount;
    // Drop near-zero entries so toggled-off evidence leaves no residue.
    if (Math.abs(next) < 1e-9) delete map[key];
    else map[key] = next;
  }
}

/**
 * Apply one row transition to a profile IN PLACE and report whether taste
 * changed (rating verdict, save or hide flipped). Pass `created: true` when
 * the rating row itself is new (counts an impression).
 */
export function applyTransition(
  profile: ProfileSnapshot,
  prev: RowState | null,
  next: RowState,
  facets: TransitionFacets,
  created: boolean,
): { tasteChanged: boolean } {
  const before: RowState = prev ?? {};
  if (created) profile.impressionCount += 1;

  // Rating verdict movement.
  const verdictBefore = verdict(before.value);
  const verdictAfter = verdict(next.value);
  if (verdictBefore !== verdictAfter) {
    if (before.value !== undefined) profile.ratingCount -= 1;
    if (next.value !== undefined) profile.ratingCount += 1;
    if (verdictBefore === "positive") profile.positiveCount -= 1;
    if (verdictBefore === "negative") profile.negativeCount -= 1;
    if (verdictAfter === "positive") profile.positiveCount += 1;
    if (verdictAfter === "negative") profile.negativeCount += 1;
  }

  // Save / hide toggles.
  if ((before.saved === true) !== (next.saved === true)) {
    profile.savedCount += next.saved === true ? 1 : -1;
  }
  if ((before.hidden === true) !== (next.hidden === true)) {
    profile.hiddenCount += next.hidden === true ? 1 : -1;
  }

  // Open counters only grow (they are monotonic per row).
  const githubDelta = Math.max(
    0,
    (next.githubOpens ?? 0) - (before.githubOpens ?? 0),
  );
  const readmeDelta = Math.max(
    0,
    (next.readmeOpens ?? 0) - (before.readmeOpens ?? 0),
  );
  profile.githubOpenCount += githubDelta;
  profile.readmeOpenCount += readmeDelta;

  // Affinity delta = new credit minus old credit, per facet.
  const delta = affinityCredit(next) - affinityCredit(before);
  addCredit(profile.topicAffinity, facets.topics, delta);
  addCredit(profile.languageAffinity, [facets.language], delta);
  addCredit(profile.ownerAffinity, [facets.owner], delta);

  const tasteChanged =
    verdictBefore !== verdictAfter ||
    before.saved !== next.saved ||
    before.hidden !== next.hidden;
  if (tasteChanged) profile.feedVersion += 1;
  return { tasteChanged };
}

/**
 * Aggregate a batch of newly-seen rows (markSeen path) into one profile patch
 * instead of one write per row.
 */
export function applyImpressions(
  profile: ProfileSnapshot,
  count: number,
): void {
  if (count > 0) profile.impressionCount += count;
}

function mapsEqual(a: Record<string, number>, b: Map<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...b.keys()]);
  for (const key of keys) {
    if (Math.abs((a[key] ?? 0) - (b.get(key) ?? 0)) > 1e-9) return false;
  }
  return true;
}

/**
 * Parity check: replaying history through transitions must equal
 * `buildSignals` affinity maps. Used by tests; also suitable as a periodic
 * self-heal assertion for the stored profile.
 */
export function profileMatchesSignals(
  profile: ProfileSnapshot,
  rows: RatedRepo[],
  now: number,
): boolean {
  const signals = buildSignals(now, rows);
  return (
    mapsEqual(profile.topicAffinity, signals.topicAffinity) &&
    mapsEqual(profile.languageAffinity, signals.languageAffinity) &&
    mapsEqual(profile.ownerAffinity, signals.ownerAffinity)
  );
}

/** Stored form: affinity maps as key/count arrays (no `v.record` needed). */
export function toStorable(profile: ProfileSnapshot): {
  topicAffinity: { key: string; count: number }[];
  languageAffinity: { key: string; count: number }[];
  ownerAffinity: { key: string; count: number }[];
} {
  const entries = (map: Record<string, number>) =>
    Object.entries(map).map(([key, count]) => ({ key, count }));
  return {
    topicAffinity: entries(profile.topicAffinity),
    languageAffinity: entries(profile.languageAffinity),
    ownerAffinity: entries(profile.ownerAffinity),
  };
}

export function fromStorable(stored: {
  topicAffinity: { key: string; count: number }[];
  languageAffinity: { key: string; count: number }[];
  ownerAffinity: { key: string; count: number }[];
}): Pick<
  ProfileSnapshot,
  "topicAffinity" | "languageAffinity" | "ownerAffinity"
> {
  const toMap = (entries: { key: string; count: number }[]) => {
    const map: Record<string, number> = {};
    for (const entry of entries) map[entry.key] = entry.count;
    return map;
  };
  return {
    topicAffinity: toMap(stored.topicAffinity),
    languageAffinity: toMap(stored.languageAffinity),
    ownerAffinity: toMap(stored.ownerAffinity),
  };
}
