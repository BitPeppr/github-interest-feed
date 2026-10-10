/**
 * Explicit exploration. Exploration candidates are retrieved on their own
 * path — ranked by how unexplored they are, not by exploitation score — so
 * genuinely unusual repositories can reach the feed even when their predicted
 * interest is low. Nothing here uses randomness: the selection is
 * deterministic given the same catalog and signals.
 */
import { EXPLORE_SHORTLIST_FACTOR } from "./constants";
import { selectWindow } from "./rerank";
import { facetsOf, unexploredness } from "./scoring";
import type { RepoSnapshot, Signals } from "./types";

export interface ExplorationPick {
  repo: RepoSnapshot;
  explore: number;
  facets: Set<string>;
}

/**
 * Select exploration candidates from the full unseen set (NOT from the
 * top-scored pool — that ordering would defeat the purpose). Shortlist the
 * most unexplored, then diversify greedily so one novel facet cannot fill
 * every exploration slot.
 */
export function selectExploration(
  unseen: RepoSnapshot[],
  signals: Signals,
  slots: number,
): ExplorationPick[] {
  if (slots <= 0 || unseen.length === 0) return [];
  const shortlist = unseen
    .map((repo) => ({
      repo,
      explore: unexploredness(repo, signals),
      facets: facetsOf(repo),
    }))
    .filter((entry) => entry.explore >= 1)
    .sort((a, b) => b.explore - a.explore || a.repo.repoId - b.repo.repoId)
    .slice(0, Math.max(slots, slots * EXPLORE_SHORTLIST_FACTOR));
  return selectWindow(
    shortlist.map((entry) => ({
      item: entry,
      score: entry.explore,
      facets: entry.facets,
      owner: entry.repo.owner,
      language: entry.repo.language,
    })),
    slots,
  );
}
