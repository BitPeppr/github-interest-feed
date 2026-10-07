/**
 * User signals: affinities, dislikes and exposure counts derived from rating
 * history. Pure and unit tested — database access stays in `feed.ts`.
 */
import {
  DISLIKE_LANGUAGE,
  DISLIKE_OWNER,
  DISLIKE_TOPIC,
  HIDE_DISLIKE_WEIGHT,
  LOW_RATING_DISLIKE_WEIGHT,
  NEGATIVE_RATING_THRESHOLD,
  POSITIVE_RATING_THRESHOLD,
} from "./constants";
import type { RatedRepo, Signals } from "./types";

export function emptySignals(now: number): Signals {
  return {
    now,
    totalImpressions: 0,
    topicAffinity: new Map(),
    languageAffinity: new Map(),
    ownerAffinity: new Map(),
    topicDislike: new Map(),
    languageDislike: new Map(),
    ownerDislike: new Map(),
    topicSeen: new Map(),
    languageSeen: new Map(),
    ownerSeen: new Map(),
  };
}

function countBy(values: Iterable<string>, counts: Map<string, number>): void {
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
}

/** Keeps the strongest dislike for a facet; repeated skips do not stack. */
function lower(
  map: Map<string, number>,
  names: Iterable<string>,
  amount: number,
): void {
  for (const name of names) {
    map.set(name, Math.min(map.get(name) ?? 0, amount));
  }
}

/**
 * Fold rating history into signals. Every row is one impression (exposure).
 * Ratings >= 4 build capped affinity; hides and ratings <= 2 build dislikes,
 * with a hide weighing more than a low score.
 */
export function buildSignals(now: number, rows: RatedRepo[]): Signals {
  const signals = emptySignals(now);
  for (const row of rows) {
    signals.totalImpressions += 1;
    countBy(row.repo.topics, signals.topicSeen);
    if (row.repo.language) countBy([row.repo.language], signals.languageSeen);
    countBy([row.repo.owner], signals.ownerSeen);

    if ((row.value ?? 0) >= POSITIVE_RATING_THRESHOLD) {
      countBy(row.repo.topics, signals.topicAffinity);
      if (row.repo.language) {
        countBy([row.repo.language], signals.languageAffinity);
      }
      countBy([row.repo.owner], signals.ownerAffinity);
      continue;
    }

    const skipped = row.hidden === true;
    const uninteresting =
      typeof row.value === "number" && row.value <= NEGATIVE_RATING_THRESHOLD;
    if (!skipped && !uninteresting) continue;
    const weight = skipped ? HIDE_DISLIKE_WEIGHT : LOW_RATING_DISLIKE_WEIGHT;
    lower(signals.topicDislike, row.repo.topics, DISLIKE_TOPIC * weight);
    if (row.repo.language) {
      lower(
        signals.languageDislike,
        [row.repo.language],
        DISLIKE_LANGUAGE * weight,
      );
    }
    lower(signals.ownerDislike, [row.repo.owner], DISLIKE_OWNER * weight);
  }
  return signals;
}
