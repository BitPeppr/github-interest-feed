/**
 * A small, deliberately boring README parser.
 *
 * It never produces HTML: the renderer turns these blocks into React elements,
 * so a README can never inject markup. It handles the subset READMEs actually
 * use — headings, paragraphs, lists, code, quotes, rules and simple tables —
 * after normalising the HTML that GitHub-flavoured READMEs are full of.
 */

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; language: string | null; code: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "table"; rows: string[][] };

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  middot: "·",
  times: "×",
};

const BLOCK_CLOSERS =
  /<\/(?:p|div|section|article|center|details|summary|table|thead|tbody|tr|td|th|li|ul|ol|h[1-6]|blockquote|pre|figure|figcaption|dl|dd|dt)>/gi;

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match ? match[1] : null;
}

function decodeEntities(value: string): string {
  return value.replace(/&(#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const code = Number(entity.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Rewrite the HTML that shows up in READMEs into markdown we understand. */
export function normalizeReadme(source: string): string {
  let text = source.replace(/\r\n?/g, "\n");
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<img\b[^>]*>/gi, (tag) => {
    const src =
      attribute(tag, "src") ??
      attribute(tag, "srcset")?.split(",")[0]?.trim().split(/\s+/)[0];
    if (!src) return "";
    const alt = attribute(tag, "alt") ?? "";
    return `![${alt}](${src})`;
  });
  text = text.replace(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, inner: string) =>
      `[${inner
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()}](${href})`,
  );
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");
  text = text.replace(BLOCK_CLOSERS, "\n\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/[ \t]+$/gm, "");
  return decodeEntities(text);
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string | undefined): boolean {
  if (!line || !line.includes("-")) return false;
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line);
}

function isBlockStart(line: string, next: string | undefined): boolean {
  return (
    /^\s*(```|~~~)/.test(line) ||
    /^(#{1,6})\s+/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*([-*_])\s*(\1\s*){2,}$/.test(line) ||
    /^\s*([-*+]|\d+[.)])\s+/.test(line) ||
    (line.includes("|") && isTableSeparator(next))
  );
}

export function parseMarkdown(source: string, title?: string): Block[] {
  const lines = normalizeReadme(source).split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length && blocks.length < 220) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*(```|~~~)\s*([\w+#.-]*)\s*$/);
    if (fence) {
      const marker = fence[1];
      const code: string[] = [];
      index += 1;
      while (
        index < lines.length &&
        !new RegExp(`^\\s*${marker}\\s*$`).test(lines[index])
      ) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({
        kind: "code",
        language: fence[2] || null,
        code: code.join("\n").replace(/\s+$/, ""),
      });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2].trim(),
      });
      index += 1;
      continue;
    }

    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", text: quoted.join(" ").trim() });
      continue;
    }

    if (line.includes("|") && isTableSeparator(lines[index + 1])) {
      const rows: string[][] = [splitRow(line)];
      index += 2;
      while (index < lines.length && lines[index].includes("|")) {
        rows.push(splitRow(lines[index]));
        index += 1;
      }
      blocks.push({ kind: "table", rows });
      continue;
    }

    const listItem = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (listItem) {
      const ordered = /\d/.test(listItem[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (match) {
          items.push(match[2]);
          index += 1;
          continue;
        }
        // Indented continuation belongs to the item above it.
        if (
          items.length > 0 &&
          lines[index].trim() &&
          /^\s{2,}\S/.test(lines[index])
        ) {
          items[items.length - 1] += ` ${lines[index].trim()}`;
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isBlockStart(lines[index], lines[index + 1])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.length === 0) {
      paragraph.push(lines[index]?.trim() ?? "");
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return tidy(blocks, title);
}

/** Strip markup so we can tell whether a block says anything at all. */
function visibleText(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~|]/g, "")
    .replace(/\s+/g, "");
}

function tidy(blocks: Block[], title?: string): Block[] {
  const wanted = title?.trim().toLowerCase();
  const kept: Block[] = [];

  for (const block of blocks) {
    if (block.kind === "rule") {
      if (kept.length === 0 || kept[kept.length - 1].kind === "rule") continue;
      kept.push(block);
      continue;
    }

    if (block.kind === "heading" || block.kind === "paragraph") {
      const text = block.text.trim();
      if (!text) continue;
      // Badge walls and pure image rows are noise.
      if (block.kind === "paragraph" && visibleText(text) === "") continue;
      if (kept.length === 0 && wanted) {
        const plain = visibleText(text).toLowerCase();
        if (plain === wanted || plain === wanted.replace(/[^a-z0-9]/g, "")) {
          continue;
        }
      }
      kept.push({ ...block, text });
      continue;
    }

    if (block.kind === "list") {
      const items = block.items.filter((item) => item.trim() !== "");
      if (items.length === 0) continue;
      kept.push({ ...block, items });
      continue;
    }

    if (block.kind === "table") {
      if (block.rows.length === 0) continue;
      kept.push(block);
      continue;
    }

    if (block.kind === "quote" && !block.text) continue;
    if (block.kind === "code" && !block.code.trim()) continue;
    kept.push(block);
  }

  return kept;
}
