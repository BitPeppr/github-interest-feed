/**
 * Helpers for pulling READMEs and screenshots straight from GitHub's raw
 * content host. Raw fetches are not part of the REST API rate limit, which is
 * why enrichment never touches api.github.com.
 */

const README_NAMES = ["README.md", "readme.md", "Readme.md", "README.rst"];

/** Text we never want to render as a "screenshot". */
const BADGE_MARKERS = [
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
  "camo.githubusercontent.com/.*badge",
];

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif)(?:[?#]|$)/i;

/** Raw GitHub paths for each README name, most likely first. */
export function readmeUrls(fullName: string): string[] {
  return README_NAMES.map(
    (name) => `https://raw.githubusercontent.com/${fullName}/HEAD/${name}`,
  );
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match ? match[1] : null;
}

/** `github.com/owner/repo/blob/HEAD/path` -> `raw.githubusercontent.com/...` */
function toRawGithubUrl(url: string): string {
  const match = url.match(
    /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:blob|raw)\/([^\s?#]+)(?:\?[^\s]*)?$/i,
  );
  if (!match) return url;
  const [, owner, repo, path] = match;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${path}`;
}

function resolveImageUrl(raw: string, fullName: string): string | null {
  const trimmed = raw.trim().replace(/^<|>$/g, "");
  if (!trimmed || trimmed.startsWith("data:")) return null;

  let absolute: string;
  try {
    absolute = new URL(trimmed, `https://raw.githubusercontent.com/${fullName}/HEAD/`)
      .toString();
  } catch {
    return null;
  }
  absolute = toRawGithubUrl(absolute);
  if (!absolute.startsWith("https://")) return null;
  if (BADGE_MARKERS.some((marker) => new RegExp(marker, "i").test(absolute))) {
    return null;
  }

  const isAttachment = /github\.com\/(user-attachments|assets)\//.test(absolute);
  // SVG in a README is almost always a badge or a wordmark, not a screenshot.
  if (!isAttachment && !IMAGE_EXTENSION.test(absolute)) return null;
  if (absolute.endsWith(".svg")) return null;
  return absolute;
}

/**
 * Pull up to `limit` screenshot URLs out of a README, in the order they appear.
 * Relative paths resolve against the repository's default branch.
 */
export function extractImages(
  markdown: string,
  fullName: string,
  limit = 3,
): string[] {
  const found: string[] = [];
  const push = (candidate: string | undefined | null) => {
    if (!candidate) return;
    const url = resolveImageUrl(candidate, fullName);
    if (url && !found.includes(url)) found.push(url);
  };

  // <img src="..."> and <source srcset="... 1x, ... 2x">
  for (const tag of markdown.match(/<img\b[^>]*>/gi) ?? []) {
    push(attribute(tag, "src"));
    const srcset = attribute(tag, "srcset");
    if (srcset) push(srcset.split(",")[0]?.trim().split(/\s+/)[0]);
  }
  // ![alt](url "title")
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?/g)) {
    push(match[1]);
  }

  return found.slice(0, limit);
}
