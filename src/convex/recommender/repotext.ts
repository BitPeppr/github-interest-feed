/**
 * Canonical textual representation of a repository for embedding.
 *
 * Raw READMEs are badge walls, install logs and changelogs as often as they
 * are substance. `cleanReadme` strips the predictable noise before the text
 * is truncated, so embedding tokens describe the project, not its CI badges.
 * Pure and Convex-safe (no Node APIs).
 */

/** Hosts/markers that mark an image as a badge, not content. */
const BADGE_PATTERNS = [
  "shields.io",
  "badgen.net",
  "badge.fury.io",
  "img.shields",
  "travis-ci",
  "circleci.com",
  "codecov.io",
  "coveralls.io",
  "sonarcloud.io",
  "snyk.io",
  "opencollective.com",
  "discord.gg",
  "gitter.im",
  "deepwiki.com",
  "star-history.com",
  "/actions/workflows/",
  "/badge.svg",
  "badge.png",
];

function isBadgeUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return BADGE_PATTERNS.some((marker) => lower.includes(marker.toLowerCase()));
}

/** Remove HTML comments, badge images and badge links from markdown. */
export function cleanReadme(markdown: string): string {
  let text = markdown.replace(/<!--[\s\S]*?-->/g, "\n");

  const lines = text.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Markdown badge images: ![...](url) or [![...](...)](...)
    const images = [...trimmed.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?/g)].map(
      (match) => match[1],
    );
    if (images.length > 0 && images.every(isBadgeUrl)) continue;
    // Bare badge links on their own line.
    if (/^\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)$/.test(trimmed)) {
      const urls = [...trimmed.matchAll(/\((https?[^)]+)\)/g)].map(
        (match) => match[1],
      );
      if (urls.length > 0 && urls.every(isBadgeUrl)) continue;
    }
    // <img> badge tags.
    if (
      /<img\b[^>]*>/i.test(trimmed) &&
      isBadgeUrl(trimmed) &&
      trimmed.length < 500
    ) {
      continue;
    }
    kept.push(line);
  }
  text = kept.join("\n");

  // Collapse blank walls and over-long whitespace runs.
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

/** djb2 hex digest — stable, dependency-free change detection for backfill. */
export function textHash(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export interface RepoTextInput {
  fullName: string;
  description?: string;
  language?: string;
  topics: string[];
  readme?: string | null;
}

/**
 * Canonical embedding text. Field labels keep the model from confusing a
 * topic list with prose. README excerpt is cleaned and capped — the head of
 * a README describes the project; the tail is usually API docs.
 */
export function buildRepoText(
  input: RepoTextInput,
  maxChars = 4000,
  readmeChars = 2500,
): string {
  const sections: string[] = [`Repository: ${input.fullName}`];
  if (input.description?.trim()) {
    sections.push(`Description: ${input.description.trim().slice(0, 500)}`);
  }
  if (input.language) sections.push(`Language: ${input.language}`);
  if (input.topics.length > 0) {
    sections.push(`Topics: ${input.topics.slice(0, 12).join(", ")}`);
  }
  if (input.readme) {
    const cleaned = cleanReadme(input.readme).slice(0, readmeChars).trim();
    if (cleaned) sections.push(`README:\n${cleaned}`);
  }
  return sections.join("\n\n").slice(0, maxChars);
}
