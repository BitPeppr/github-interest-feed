import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { ArrowDown, ArrowUp, Bookmark, ExternalLink, EyeOff, GitFork, LoaderCircle, BookOpen, Star } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InterestScale } from "@/components/feed/interest-scale";
import type { Project } from "@/components/feed/types";
import { api } from "@/convex/_generated/api";
import { Markdown } from "@/lib/markdown";
import { formatCompact, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ReelCardProps {
  project: Project;
  active: boolean;
  onRate: (repoId: number, value: number) => void;
  onClear: (repoId: number) => void;
  onToggleSaved: (repoId: number, saved: boolean) => void;
  onSkip: (repoId: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onRated: () => void;
}

export function ReelCard({ project, active, onRate, onClear, onToggleSaved, onSkip, onPrevious, onNext, onRated }: ReelCardProps) {
  const [readmeOpen, setReadmeOpen] = useState(false);
  const [rating, setRating] = useState(project.rating);
  const [saved, setSaved] = useState(project.saved);
  const [identity, setIdentity] = useState(project.repoId);
  const enriched = useRef(false);
  const readme = useQuery(api.feed.readme, readmeOpen && active ? { repoId: project.repoId } : "skip");
  const enrich = useAction(api.github.enrich);

  if (identity !== project.repoId) {
    setIdentity(project.repoId);
    setRating(project.rating);
    setSaved(project.saved);
  }
  useEffect(() => {
    if (!readmeOpen || !active || readme?.readmeLoaded || enriched.current) return;
    enriched.current = true;
    void enrich({ repoIds: [project.repoId] }).catch((error) => {
      enriched.current = false;
      toast.error(error instanceof Error ? error.message : "Could not load README.");
    });
  }, [active, enrich, project.repoId, readme?.readmeLoaded, readmeOpen]);

  const updated = formatRelative(project.pushedAt);

  return (
    <section data-repo-id={project.repoId} className="flex min-h-[calc(100svh-56px)] snap-start snap-always items-center py-5 sm:py-8">
      <article className="mx-auto flex w-full max-w-3xl flex-col rounded-2xl border border-border bg-card">
        <header className="flex items-start gap-4 px-5 pt-5 sm:px-8 sm:pt-8">
          <img src={`https://github.com/${project.owner}.png?size=96`} alt="" loading="lazy" decoding="async" width={44} height={44} className="size-11 shrink-0 rounded-full border border-border bg-muted" />
          <div className="min-w-0 flex-1">
            <a href={project.url} target="_blank" rel="noreferrer noopener" className="block truncate text-lg font-semibold tracking-tight underline-offset-4 hover:underline sm:text-xl">
              <span className="text-muted-foreground">{project.owner}</span><span className="text-muted-foreground/50"> / </span>{project.name}
            </a>
            <p className="mt-1 text-sm text-muted-foreground">{project.language ? `${project.language} · ` : ""}{formatCompact(project.stars)} stars{updated ? ` · updated ${updated}` : ""}</p>
          </div>
          <Button variant="ghost" size="icon-sm" asChild><a href={project.url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${project.fullName} on GitHub`}><ExternalLink className="size-4" /></a></Button>
        </header>

        <div className="px-5 pt-6 sm:px-8 sm:pt-8">
          <p className="text-lg leading-relaxed text-foreground sm:text-xl">{project.description || "No description provided."}</p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Star className="size-4" aria-hidden />{formatCompact(project.stars)}</span>
            <span className="inline-flex items-center gap-1.5"><GitFork className="size-4" aria-hidden />{formatCompact(project.forks)}</span>
            {project.license && <span>{project.license}</span>}
            {project.archived && <span>Archived</span>}
          </div>
          {project.topics.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{project.topics.slice(0, 6).map((topic) => <span key={topic} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">{topic}</span>)}</div>}
        </div>

        <div className="mt-7 border-t border-border px-5 py-4 sm:px-8">
          <Button variant="outline" className="gap-2" onClick={() => setReadmeOpen(true)}><BookOpen className="size-4" />Explore full README</Button>
        </div>

        <footer className="mt-auto flex flex-col gap-4 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <InterestScale value={rating} autoAdvance onRated={onRated} onRate={(value) => {
            setRating(value);
            onRate(project.repoId, value);
          }} onClear={() => {
            setRating(null);
            onClear(project.repoId);
          }} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={saved ? "default" : "outline"} size="sm" className="gap-1.5" aria-pressed={saved} onClick={() => {
              const next = !saved;
              setSaved(next);
              onToggleSaved(project.repoId, next);
            }}><Bookmark className={cn("size-3.5", saved && "fill-current")} />{saved ? "Saved" : "Save"}</Button>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => onSkip(project.repoId)}><EyeOff className="size-3.5" />Skip</Button>
            <Button variant="ghost" size="sm" onClick={onPrevious} aria-label="Previous project"><ArrowUp className="size-4" /><span className="sr-only sm:not-sr-only">Previous</span></Button>
            <Button variant="ghost" size="sm" onClick={onNext} aria-label="Next project"><ArrowDown className="size-4" /><span className="sr-only sm:not-sr-only">Next</span></Button>
          </div>
        </footer>
      </article>

      <Dialog open={readmeOpen} onOpenChange={setReadmeOpen}>
        <DialogContent className="flex max-h-[88svh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-12 text-left">
            <DialogTitle>{project.fullName}</DialogTitle>
            <DialogDescription>README</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-6 py-6 sm:px-8">
            {readme?.readme ? <Markdown source={readme.readme} title={project.name} className="text-foreground/90" /> : readme?.readmeLoaded ? <p className="text-sm text-muted-foreground">No README found.</p> : <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading README…</div>}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
