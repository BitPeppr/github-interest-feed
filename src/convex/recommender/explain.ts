/**
 * "Why am I seeing this?" — built ONLY from the real ranking path:
 * candidate provenance, measured features and the user's own signals.
 * Nothing here invents a story the ranker did not tell.
 */
import type { RepoSnapshot, ScoredCandidate, Signals } from "./types";

export interface ExplanationInput {
  candidate: ScoredCandidate;
  signals: Signals;
  followedTopics: Set<string>;
}

/** Topics on the repo the user has genuine learned affinity for, best first. */
function matchedAffinityTopics(repo: RepoSnapshot, signals: Signals): string[] {
  return repo.topics
    .filter((topic) => (signals.topicAffinity.get(topic) ?? 0) > 0)
    .sort(
      (a, b) =>
        (signals.topicAffinity.get(b) ?? 0) -
          (signals.topicAffinity.get(a) ?? 0) || a.localeCompare(b),
    );
}

function matchedFollowedTopics(
  repo: RepoSnapshot,
  followedTopics: Set<string>,
): string[] {
  return repo.topics.filter((topic) => followedTopics.has(topic)).sort();
}

/**
 * At most two short reasons, ordered by evidence strength. Stated (followed)
 * preferences outrank learned ones; exploration is the reason of last resort,
 * not a garnish on top of a relevance story.
 */
export function explainCandidate(input: ExplanationInput): string[] {
  const { candidate, signals, followedTopics } = input;
  const { repo, features, sources } = candidate;
  const reasons: string[] = [];

  const followed = matchedFollowedTopics(repo, followedTopics);
  if (followed.length > 0) {
    reasons.push(`Because you follow ${followed[0]}`);
  }

  const affinity = matchedAffinityTopics(repo, signals);
  if (affinity.length > 0) {
    reasons.push(`Similar to ${affinity[0]} projects you rated highly`);
  } else if (
    repo.language &&
    (signals.languageAffinity.get(repo.language) ?? 0) > 0
  ) {
    reasons.push(`Matches your interest in ${repo.language}`);
  } else if ((signals.ownerAffinity.get(repo.owner) ?? 0) > 0) {
    reasons.push(`More from ${repo.owner}, whose projects you liked`);
  }

  if (reasons.length === 0) {
    if (sources.includes("exploration")) {
      reasons.push("Exploration pick outside your usual areas");
    } else if (features.freshness > 0.5) {
      reasons.push("Recently active in an area you follow");
    } else if (sources.includes("long-tail")) {
      reasons.push("Lesser-known project worth a look");
    } else if (sources.includes("fresh")) {
      reasons.push("Recently active project");
    } else {
      reasons.push("New in the discovery catalog");
    }
  } else if (
    reasons.length === 1 &&
    sources.includes("exploration") &&
    features.exploration > 0.5
  ) {
    reasons.push("An underexplored corner for you");
  }

  return reasons.slice(0, 2);
}
