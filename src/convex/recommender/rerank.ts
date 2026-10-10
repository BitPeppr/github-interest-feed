/**
 * Greedy diversity reranker (cheap MMR/DPP analogue). For each slot, take the
 * candidate worth the most after subtracting its similarity to what is already
 * chosen, with per-owner decay so one author cannot fill the window and a
 * milder per-language decay so one ecosystem cannot either.
 *
 * The similarity penalty is cumulative (summed over chosen items), not a max:
 * with a max-penalty, ten near-identical projects each pay the cost once and
 * still occupy the whole window whenever their scores differ by less than the
 * penalty. Accumulating makes the fifth copy pay five times, which is what
 * guarantees diverse slates.
 *
 * Generic over the candidate payload so exploration (scored by novelty) and
 * exploitation (scored by interest) share one tested implementation.
 */
import {
  LANGUAGE_REPEAT_DECAY,
  LANGUAGE_REPEAT_FLOOR,
  LANGUAGE_REPEAT_FREE,
  REPEAT_DECAY,
  REPEAT_FLOOR,
  SIMILARITY_PENALTY,
} from "./constants";
import { jaccard } from "./scoring";

export interface RerankEntry<T> {
  item: T;
  score: number;
  facets: Set<string>;
  owner: string;
  /** Optional; enables per-language decay when supplied. */
  language?: string;
}

/**
 * Multiplicative decay applied once a facet has been used. The first
 * `free` uses cost nothing, then each further use decays toward `floor`.
 */
function repeatDecay(
  used: number,
  free: number,
  decay: number,
  floor: number,
): number {
  if (used < free) return 1;
  return Math.max(floor, decay ** (used - free + 1));
}

export function selectWindow<T>(
  pool: RerankEntry<T>[],
  size: number,
  penalties: {
    similarity?: number;
    decay?: number;
    floor?: number;
    languageDecay?: number;
    languageFloor?: number;
    languageFree?: number;
  } = {},
): T[] {
  const similarityPenalty = penalties.similarity ?? SIMILARITY_PENALTY;
  const decay = penalties.decay ?? REPEAT_DECAY;
  const floor = penalties.floor ?? REPEAT_FLOOR;
  const languageDecay = penalties.languageDecay ?? LANGUAGE_REPEAT_DECAY;
  const languageFloor = penalties.languageFloor ?? LANGUAGE_REPEAT_FLOOR;
  const languageFree = penalties.languageFree ?? LANGUAGE_REPEAT_FREE;

  const chosen: RerankEntry<T>[] = [];
  const remaining = [...pool];
  const ownerRepeats = new Map<string, number>();
  const languageRepeats = new Map<string, number>();

  while (chosen.length < size && remaining.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index];
      let similarity = 0;
      for (const picked of chosen) {
        similarity += jaccard(entry.facets, picked.facets);
      }
      const repeats = ownerRepeats.get(entry.owner) ?? 0;
      const ownerMultiplier =
        repeats === 0 ? 1 : Math.max(floor, decay ** repeats);
      // Languages do not register strongly in facet similarity, so they need
      // their own, milder counter to stop one ecosystem flooding the window.
      const languageMultiplier = entry.language
        ? repeatDecay(
            languageRepeats.get(entry.language) ?? 0,
            languageFree,
            languageDecay,
            languageFloor,
          )
        : 1;
      const value =
        (entry.score - similarityPenalty * similarity) *
        ownerMultiplier *
        languageMultiplier;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }
    const [picked] = remaining.splice(bestIndex, 1);
    chosen.push(picked);
    ownerRepeats.set(picked.owner, (ownerRepeats.get(picked.owner) ?? 0) + 1);
    if (picked.language) {
      languageRepeats.set(
        picked.language,
        (languageRepeats.get(picked.language) ?? 0) + 1,
      );
    }
  }
  return chosen.map((entry) => entry.item);
}

/**
 * Spread exploration picks through the window instead of bunching them up.
 * Deterministic: position is a function of counts, not of randomness.
 */
export function interleave<T>(explore: T[], ranked: T[], size: number): T[] {
  if (explore.length === 0) return ranked.slice(0, size);
  if (ranked.length === 0) return explore.slice(0, size);
  const every = Math.max(1, Math.round(size / explore.length));
  const out: T[] = [];
  let e = 0;
  let r = 0;
  while (out.length < size && (e < explore.length || r < ranked.length)) {
    if (e < explore.length && out.length % every === 0) {
      out.push(explore[e]);
      e += 1;
    } else if (r < ranked.length) {
      out.push(ranked[r]);
      r += 1;
    } else {
      out.push(explore[e]);
      e += 1;
    }
  }
  return out;
}
