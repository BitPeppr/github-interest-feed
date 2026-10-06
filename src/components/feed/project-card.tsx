import { useEffect, useRef, useState } from "react";
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
import { formatCompact, formatRelative } from "@/lib/format";
import { Markdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";

/** Long READMEs stay folded so the feed keeps scrolling smoothly. */
const FOLD_LENGTH = 700;

interface ProjectCardProps {
  project: Project;
  onRate: (repoId: number, value: number) => void;
  onClear: (repoId: number) => void;
  onToggleSaved: (repoId: number, saved: boolean) => void;
  onHide: (repoId: number) => void;
  onNext: () => void;
  onSeen: (repoId: number) => void;
}

function MediaStrip({ project }: { project: Project }) {
  const [broken, setBroken] = useState<string[]>([]);
  const [fallbackBroken, setFallbackBroken] = useState(false);

  const images = project.images
    .slice(0, 3)
    .filter((image) => !broken.includes(image));
  const fallback = `https://opengraph.githubassets.com/1/${project.fullName}`;

  if (images.length === 0 && (fallbackBroken || project.images.length > 0)) {
    return null;
  }

  const sources = images.length > 0 ? images : [fallback];

  return (
    <section className="mt-4 border-y border-border bg-muted/30">
      <div className="flex snap-x snap-mandatory overflow-x-auto">
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
              onError={() =>
                source === fallback
                  ? setFallbackBroken(true)
                  : setBroken((previous) => [...previous, source])
              }
              className="h-56 w-full object-cover object-top sm:h-64"
            />
            {sources.length > 1 && (
              <figcaption className="absolute right-3 bottom-3 rounded-full border border-border bg-background/90 px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums">
                {index + 1} / {sources.length}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
    </section>
  );
}

/**
 * One project in the feed: identity, screenshots, its README, and the controls
 * for rating it, saving it, dismissing it and moving on.
 */
export function ProjectCard({
  project,
  onRate,
  onClear,
  onToggleSaved,
  onHide,
  onNext,
  onSeen,
}: ProjectCardProps) {
  const articleRef = useRef<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState(false);

  // A card counts as seen once half of it has been on screen.
  useEffect(() => {
    const node = articleRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onSeen(project.repoId);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onSeen, project.repoId]);

  const updated = formatRelative(project.pushedAt);
  const foldable = (project.readme?.length ?? 0) > FOLD_LENGTH;

  return (
    <article
      ref={articleRef}
      className="scroll-mt-20 rounded-xl border border-border bg-card"
    >
      <header className="flex items-start gap-3 px-5 pt-5 sm:px-6">
        <img
          src={`https://github.com/${project.owner}.png?size=80`}
          alt=""
          loading="lazy"
          className="size-9 shrink-0 rounded-full border border-border"
        />
        <div className="min-w-0 flex-1">
          <a
            href={project.url}
            target="_blank"
            rel="noreferrer noopener"
            className="block truncate text-[15px] font-medium tracking-[-0.01em] underline-offset-4 hover:underline"
          >
            <span className="text-muted-foreground">{project.owner}</span>
            <span className="text-muted-foreground/50"> / </span>
            {project.name}
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
          <p className="text-sm leading-relaxed text-foreground/90">
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
          {project.topics.slice(0, 3).map((topic) => (
            <span
              key={topic}
              className="rounded-full border border-border px-2 py-0.5 text-[11px]"
            >
              {topic}
            </span>
          ))}
        </div>
      </div>

      <MediaStrip project={project} />

      <div className="px-5 pt-4 sm:px-6">
        {project.readme ? (
          <>
            <div
              className={cn(
                "relative",
                !expanded && foldable && "max-h-[22rem] overflow-hidden",
              )}
            >
              <Markdown source={project.readme} title={project.name} />
              {!expanded && foldable && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-card to-transparent" />
              )}
            </div>
            {foldable && (
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
            )}
          </>
        ) : project.readmeLoaded ? (
          <p className="text-xs text-muted-foreground">
            This project does not ship a README.
          </p>
        ) : (
          <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            Reading the README…
          </div>
        )}
      </div>

      <footer className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-border bg-background/90 px-5 py-3 backdrop-blur-sm sm:px-6">
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
            onClick={onNext}
          >
            <ArrowDown className="size-3.5" />
            Next
          </Button>
        </div>
      </footer>
    </article>
  );
}
