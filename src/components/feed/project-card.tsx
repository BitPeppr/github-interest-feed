import { memo, useCallback, useEffect, useRef } from "react";
import {
  ArrowDown,
  Bookmark,
  ExternalLink,
  EyeOff,
  GitFork,
  Star,
} from "lucide-react";

import { InterestScale } from "@/components/feed/interest-scale";
import { TopicChips } from "@/components/feed/project-parts";
import type { Project } from "@/components/feed/types";
import { Button } from "@/components/ui/button";
import { formatCompact, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ProjectCardProps {
  project: Project;
  index: number;
  onRate: (repoId: number, value: number) => void;
  onClear: (repoId: number) => void;
  onToggleSaved: (repoId: number, saved: boolean) => void;
  onHide: (repoId: number) => void;
  onSeen: (repoId: number) => void;
  onPassed: (repoId: number) => void;
  onGoTo: (index: number) => void;
  registerNode: (repoId: number, node: HTMLElement | null) => void;
}

function ProjectCardBase({
  project,
  index,
  onRate,
  onClear,
  onToggleSaved,
  onHide,
  onSeen,
  onPassed,
  onGoTo,
  registerNode,
}: ProjectCardProps) {
  const nodeRef = useRef<HTMLElement | null>(null);
  const hasBeenSeen = useRef(false);
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      nodeRef.current = node;
      registerNode(project.repoId, node);
    },
    [registerNode, project.repoId],
  );

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= 0.4 && !hasBeenSeen.current) {
            hasBeenSeen.current = true;
            onSeen(project.repoId);
          }
          if (hasBeenSeen.current && entry.boundingClientRect.bottom < 0) {
            onPassed(project.repoId);
            observer.disconnect();
          }
        }
      },
      { threshold: [0, 0.4] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onPassed, onSeen, project.repoId]);

  const updated = formatRelative(project.pushedAt);

  return (
    <article
      ref={setRef}
      className="scroll-mt-20 rounded-xl border border-border bg-card"
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
          <p className="mt-1 text-xs text-muted-foreground">
            {project.language ? `${project.language} · ` : ""}
            {formatCompact(project.stars)} stars
            {updated ? ` · updated ${updated}` : ""}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" asChild>
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

      <div className="px-5 pt-4 sm:px-6">
        <p className="text-[15px] leading-relaxed text-foreground">
          {project.description || "No description provided."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Star className="size-3.5" aria-hidden />
            {formatCompact(project.stars)}
          </span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <GitFork className="size-3.5" aria-hidden />
            {formatCompact(project.forks)}
          </span>
          {project.license && <span>{project.license}</span>}
          {project.archived && <span>Archived</span>}
        </div>
        <TopicChips topics={project.topics} count={4} className="mt-3" />
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 sm:px-6">
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
            Skip
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

function cardIsUnchanged(previous: ProjectCardProps, next: ProjectCardProps) {
  const a = previous.project;
  const b = next.project;
  return (
    previous.index === next.index &&
    previous.onRate === next.onRate &&
    previous.onClear === next.onClear &&
    previous.onToggleSaved === next.onToggleSaved &&
    previous.onHide === next.onHide &&
    previous.onSeen === next.onSeen &&
    previous.onPassed === next.onPassed &&
    previous.onGoTo === next.onGoTo &&
    previous.registerNode === next.registerNode &&
    a.repoId === b.repoId &&
    a.fullName === b.fullName &&
    a.owner === b.owner &&
    a.name === b.name &&
    a.rating === b.rating &&
    a.saved === b.saved &&
    a.readmeLoaded === b.readmeLoaded &&
    a.hidden === b.hidden &&
    a.url === b.url &&
    a.description === b.description &&
    a.stars === b.stars &&
    a.forks === b.forks &&
    a.language === b.language &&
    a.license === b.license &&
    a.pushedAt === b.pushedAt &&
    a.archived === b.archived &&
    a.topics.length === b.topics.length &&
    a.topics.every((topic, index) => topic === b.topics[index])
  );
}

export const ProjectCard = memo(ProjectCardBase, cardIsUnchanged);
