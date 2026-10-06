import { useMemo, useState } from "react";

import { parseMarkdown, type Block } from "@/lib/markdown-parse";
import { cn } from "@/lib/utils";

const SAFE_URL = /^https?:\/\//i;
const INLINE_PATTERN =
  /(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]]+\]\((?:<[^>]+>|[^)\s]+)\))|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;

function MarkdownImage({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      className="my-3 h-auto max-h-72 w-auto max-w-full rounded-md border border-border bg-muted/30"
    />
  );
}

/** Inline markdown only: code, images, links and emphasis. */
function renderInline(text: string, prefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    key += 1;
    const id = `${prefix}-${key}`;

    const image = token.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    const link = token.match(/^\[([^\]]+)\]\(<?([^)\s>]+)>?\)$/);

    if (image && SAFE_URL.test(image[2])) {
      nodes.push(<MarkdownImage key={id} src={image[2]} alt={image[1]} />);
    } else if (link && SAFE_URL.test(link[2])) {
      nodes.push(
        <a
          key={id}
          href={link[2]}
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium text-foreground underline underline-offset-4 hover:opacity-70"
        >
          {renderInline(link[1], id)}
        </a>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={id}
          className="rounded border border-border bg-muted/60 px-1 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(
        <strong key={id} className="font-semibold text-foreground">
          {renderInline(token.slice(2, -2), id)}
        </strong>,
      );
    } else if (token.startsWith("~~")) {
      nodes.push(
        <s key={id} className="opacity-70">
          {renderInline(token.slice(2, -2), id)}
        </s>,
      );
    } else {
      nodes.push(<em key={id}>{renderInline(token.slice(1, -1), id)}</em>);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderBlock(block: Block, index: number): React.ReactNode {
  const prefix = `b${index}`;

  switch (block.kind) {
    case "heading": {
      const Tag = block.level <= 1 ? "h3" : block.level === 2 ? "h4" : "h5";
      return (
        <Tag
          key={index}
          className={cn(
            "mt-6 mb-2 font-semibold tracking-[-0.01em] text-foreground first:mt-0",
            block.level <= 2 ? "text-base" : "text-sm",
          )}
        >
          {renderInline(block.text, prefix)}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p key={index} className="mt-3 first:mt-0">
          {renderInline(block.text, prefix)}
        </p>
      );
    case "code":
      return (
        <pre
          key={index}
          className="mt-3 overflow-x-auto rounded-md border border-border bg-muted/40 p-3"
        >
          <code className="font-mono text-xs leading-relaxed text-foreground">
            {block.code}
          </code>
        </pre>
      );
    case "list":
      return block.ordered ? (
        <ol key={index} className="mt-3 list-decimal space-y-1.5 pl-5 first:mt-0">
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>
              {renderInline(item, `${prefix}-${itemIndex}`)}
            </li>
          ))}
        </ol>
      ) : (
        <ul key={index} className="mt-3 list-disc space-y-1.5 pl-5 first:mt-0">
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>
              {renderInline(item, `${prefix}-${itemIndex}`)}
            </li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote
          key={index}
          className="mt-3 border-l-2 border-border pl-4 text-muted-foreground italic"
        >
          {renderInline(block.text, prefix)}
        </blockquote>
      );
    case "rule":
      return <hr key={index} className="mt-6 border-border" />;
    case "table":
      return (
        <div key={index} className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <tbody>
              {block.rows.map((cells, rowIndex) => (
                <tr key={rowIndex} className="border-b border-border last:border-0">
                  {cells.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={cn(
                        "px-2 py-1.5 align-top",
                        rowIndex === 0 && "font-medium text-foreground",
                      )}
                    >
                      {renderInline(cell, `${prefix}-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

/** Characters kept when a long paragraph is trimmed for a preview. */
const PREVIEW_CHARS = 420;

/** Renders a README as React elements — never as raw HTML. */
export function Markdown({
  source,
  title,
  className,
  maxBlocks,
}: {
  source: string;
  title?: string;
  className?: string;
  /** Show only the opening of the README (keeps long feeds light). */
  maxBlocks?: number;
}) {
  const blocks = useMemo(() => {
    const parsed = parseMarkdown(source, title);
    if (!maxBlocks || parsed.length <= maxBlocks) return parsed;

    const head = parsed.slice(0, maxBlocks);
    const last = head[head.length - 1];
    if (last.kind === "paragraph" && last.text.length > PREVIEW_CHARS) {
      head[head.length - 1] = {
        ...last,
        text: `${last.text.slice(0, PREVIEW_CHARS).trimEnd()}…`,
      };
    }
    return head;
  }, [source, title, maxBlocks]);

  return (
    <div
      className={cn(
        "text-sm leading-relaxed break-words text-muted-foreground",
        className,
      )}
    >
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}
