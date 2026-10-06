import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import {
  ArrowDown,
  Bookmark,
  ChevronDown,
  EyeOff,
  ExternalLink,
  GitFork,
  Star,
} from "lucide-react";

import { InterestScale } from "@/components/feed/interest-scale";
import type { Project } from "@/components/feed/types";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/convex/_generated/api";
import { formatCompact, formatRelative } from "@/lib/format";
import { Markdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";

/** How much README shows before the user asks for the rest. */
const PREVIEW_BLOCKS = 3;
/** Cards within this distance load their README. */
const NEAR_MARGIN = "1200px 0px";
/** How much of a README is parsed for the folded preview. */
const PREVIEW_SOURCE_CHARS = 3000;

/** The opening of a README, cut at a paragraph boundary so nothing renders half-finished. */
function openingOf(text: string, limit = PREVIEW_SOURCE_CHARS): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const boundary = cut.lastIndexOf("\n\n");
  return boundary > limit * 0.4 ? cut.slice(0, boundary) : cut;
}

export interface ProjectCardProps {
  project: Project;
  index: number;
  onRate: (repoId: number, value: number) => void;
  onClear: (repoId: number) => void;
  onToggleSaved: (repoId: number, saved: boolean) => void;
  onHide: (repoId: number) => void;
  onSeen: (repoId: number) => void;
  onGoTo: (index: number) => void;
  registerNode: (repoId: number, node: HTMLElement | null) => void;
}

function MediaStrip({
  project,
  ready,
}: {
  project: Project;
  ready: boolean;
}) {
  const [broken, setBroken] = useState<string[]>([]);
  const [fallbackBroken, setFallbackBroken] = useState(false);

  const images = project.images
    .slice(0, 3)
    .filter((image) => !broken.includes(image));

  const fallback = `https://opengraph.githubassets.com/1/${project.fullName}`;
  const showFallback = images.length === 0 && ready && !fallbackBroken;
  if (images.length === 0 && !showFallback) return null;

  const sources = images.length > 0 ? images : [fallback];

  return (
    <div className="mt-4 flex snap-x snap-mandatory overflow-x-auto border-y border-border bg-muted/30">
      {sources.map((source, index) => (
        <figure
          key={source}
          className="relative w-full shrink-0 snap-center"
          aria-label={
            images.length > 0
              ? `Screenshot ${index + 1} of ${images.length}`
              : "Project preview"
          }
        >
          <img
            src={source}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() =>
              source === fallback
                ? setFallbackBroken(true)
                : setBroken((previous) => [...previous, source])
            }
            className="h-44 w-full object-cover object-top sm:h-52"
          />
          {sources.length > 1 && (
            <figcaption className="absolute right-3 bottom-3 rounded-full border border-border bg-background/90 px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums">
              {index + 1} / {sources.length}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}

/**
 * One project in the feed. Cards are memoised and only fetch their README once
 * they are within a screen or so of the viewport, which keeps a long feed cheap
 * to scroll.
 */
function ProjectCardBase({
  project,
  index,
  onRate,
  onClear,
  onToggleSaved,
  onHide,
  onSeen,
  onGoTo,
  registerNode,
}: ProjectCardProps) {
  const [near, setNear] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const nodeRef = useRef<HTMLElement | null>(null);

  const readmeQuery = useQuery(
    api.feed.readme,
    near ? { repoId: project.repoId } : "skip",
  );

  const setRef = useCallback(
    (node: HTMLElement | null) => {
      nodeRef.current = node;
      registerNode(project.repoId, node);
    },
    [registerNode, project.repoId],
  );

  // Load the README shortly before the card is on screen.
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: NEAR_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Once it is near, report that it has been seen (half of it on screen).
  useEffect(() => {
    if (!near) return;
    const node = nodeRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.intersectionRatio >= 0.4)) {
          onSeen(project.repoId);
          observer.disconnect();
        }
      },
      { threshold: [0.4] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near, onSeen, project.repoId]);

  const text = readmeQuery?.readme ?? null;
  const loaded = readmeQuery?.readmeLoaded ?? project.readmeLoaded;
  const updated = formatRelative(project.pushedAt);

  // A preview only needs the opening of the README, so do not parse 12k chars
  // of markdown just to show three blocks of it.
  const previewSource = useMemo(
    () => (text && !expanded ? openingOf(text) : text),
    [text, expanded],
  );

  const topics = useMemo(() => project.topics.slice(0, 3), [project.topics]);

  return (
    <article
      ref={setRef}
      // Off-screen cards are skipped by the browser entirely, which is what
      // keeps a long feed scrolling smoothly.
      className="scroll-mt-20 rounded-xl border border-border bg-card [contain-intrinsic-size:auto_460px] [content-visibility:auto]"
    >
      <header className="flex items-start gap-3 px-5 pt-5 sm:px-6">
        <img
          src={`https://github.com/${project.owner}.png?size=80`}
          alt=""
          loading="lazy"
          decoding="async"
          width={36}
          height={36}
          className="size-9 shrink-0 rounded-full border border-border bg-muted"
        />
        <div className="min-w-0 flex-1">
          <a
            href={project.url}
            target="_blank"
            rel="noreferrer noopener"
            className="block truncate text-base font-semibold tracking-[-0.015em] underline-offset-4 hover:underline"
          >
            <span className="text-muted-foreground">{project.owner}</span>
            <span className="text-muted-foreground/50"> / </span>
            <span className="text-foreground">{project.name}</span>
          </a>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {project.language ? `${project.language} · ` : ""}
            {formatCompact(project.stars)} stars
            {updated ? ` · updated ${updated}` : ""}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          asChild
        >
          <a
            href={project.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Open ${project.fullName} on GitHub`}
          >
            <ExternalLink className="size-4" />
          </a>
        </Button>
      </header>

      <div className="px-5 pt-3 sm:px-6">
        {project.description && (
          <p className="text-[15px] leading-relaxed text-foreground">
            {project.description}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Star className="size-3.5" aria-hidden />
            {formatCompact(project.stars)}
          </span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <GitFork className="size-3.5" aria-hidden />
            {formatCompact(project.forks)}
          </span>
          {project.license && <span>{project.license}</span>}
          {project.archived && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px]">
              archived
            </span>
          )}
          {topics.map((topic) => (
            <span
              key={topic}
              className="rounded-full border border-border px-2 py-0.5 text-[11px]"
            >
              {topic}
            </span>
          ))}
        </div>
      </div>

      <MediaStrip project={project} ready={loaded} />

      <div className="px-5 pt-4 sm:px-6">
        {text ? (
          <>
            <Markdown
              source={previewSource ?? text}
              title={project.name}
              className="text-foreground/80"
              maxBlocks={expanded ? undefined : PREVIEW_BLOCKS}
            />
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 -ml-2 gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded((value) => !value)}
            >
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  expanded && "rotate-180",
                )}
              />
              {expanded ? "Show less" : "Show full readme"}
            </Button>
          </>
        ) : loaded ? (
          <p className="text-xs text-muted-foreground">
            This project does not ship a README.
          </p>
        ) : (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            Reading the README…
          </div>
        )}
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-border px-5 py-3 sm:px-6">
        <InterestScale
          value={project.rating}
          onRate={(value) => onRate(project.repoId, value)}
          onClear={() => onClear(project.repoId)}
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant={project.saved ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            aria-pressed={project.saved}
            onClick={() => onToggleSaved(project.repoId, !project.saved)}
          >
            <Bookmark
              className={cn("size-3.5", project.saved && "fill-current")}
            />
            {project.saved ? "Saved" : "Save"}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => onHide(project.repoId)}
          >
            <EyeOff className="size-3.5" />
            Not interested
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => onGoTo(index + 1)}
          >
            <ArrowDown className="size-3.5" />
            Next
          </Button>
        </div>
      </footer>
    </article>
  );
}

function listsMatch(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Re-render a card only when something it actually shows has changed. */
function cardIsUnchanged(
  previous: ProjectCardProps,
  next: ProjectCardProps,
): boolean {
  if (
    previous.index !== next.index ||
    previous.onRate !== next.onRate ||
    previous.onClear !== next.onClear ||
    previous.onToggleSaved !== next.onToggleSaved ||
    previous.onHide !== next.onHide ||
    previous.onSeen !== next.onSeen ||
    previous.onGoTo !== next.onGoTo ||
    previous.registerNode !== next.registerNode
  ) {
    return false;
  }

  const a = previous.project;
  const b = next.project;
  return (
    a.repoId === b.repoId &&
    a.rating === b.rating &&
    a.saved === b.saved &&
    a.hidden === b.hidden &&
    a.readmeLoaded === b.readmeLoaded &&
    a.description === b.description &&
    a.stars === b.stars &&
    a.forks === b.forks &&
    a.language === b.language &&
    a.license === b.license &&
    a.pushedAt === b.pushedAt &&
    a.archived === b.archived &&
    listsMatch(a.images, b.images) &&
    listsMatch(a.topics, b.topics)
  );
}

export const ProjectCard = memo(ProjectCardBase, cardIsUnchanged);
