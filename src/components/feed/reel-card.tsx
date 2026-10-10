import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Bookmark,
  ExternalLink,
  EyeOff,
  GitFork,
  Star,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { InterestScale } from "@/components/feed/interest-scale";
import { LanguageDot, TopicChips } from "@/components/feed/project-parts";
import type { Project } from "@/components/feed/types";
import { api } from "@/convex/_generated/api";
import { Markdown } from "@/lib/markdown";
import { formatCompact, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ReelCardProps {
  project: Project;
  active: boolean;
  index: number;
  /** Resolves false when the mutation failed — the card rolls back then. */
  onRate: (repoId: number, value: number) => boolean | Promise<boolean>;
  onClear: (repoId: number) => boolean | Promise<boolean>;
  /** Saving is optimistic in the parent; a failure reverts `project.saved`. */
  onToggleSaved: (repoId: number, saved: boolean) => void;
  onSkip: (repoId: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onRated: () => void;
}

/** First screenshot pulled out of the README, if the repo has one. */
function HeroImage({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <div className="relative overflow-hidden border-b border-border/70 bg-muted/40">
      <img
        src={src}
        alt={`${alt} preview`}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className="h-52 w-full object-cover object-top"
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent"
      />
    </div>
  );
}

function MetaLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[11px] tracking-[0.22em] text-muted-foreground uppercase">
      {children}
    </span>
  );
}

export function ReelCard({
  project,
  active,
  index,
  onRate,
  onClear,
  onToggleSaved,
  onSkip,
  onPrevious,
  onNext,
  onRated,
}: ReelCardProps) {
  const [readmeOpen, setReadmeOpen] = useState(false);
  const [rating, setRating] = useState(project.rating);
  const [identity, setIdentity] = useState(project.repoId);
  const requested = useRef(new Set<number>());

  // The README is the substance of the card, so it loads for the project the
  // user is actually looking at instead of waiting for a click.
  const readme = useQuery(
    api.feed.readme,
    active ? { repoId: project.repoId } : "skip",
  );
  const enrich = useAction(api.github.enrich);
  const trackEvent = useMutation(api.feed.trackEvent);
  const reported = useRef(new Set<string>());

  if (identity !== project.repoId) {
    setIdentity(project.repoId);
    setRating(project.rating);
  }

  useEffect(() => {
    if (
      !active ||
      !readme ||
      readme.readmeLoaded ||
      requested.current.has(project.repoId)
    )
      return;
    requested.current.add(project.repoId);
    void enrich({ repoIds: [project.repoId] }).catch((error) => {
      toast.error(
        error instanceof Error ? error.message : "Could not load the README.",
      );
    });
  }, [active, enrich, project.repoId, readme]);

  // Engagement is reported once per project: opening the README or GitHub
  // is deliberate interest, worth more than a passive impression.
  function report(kind: "readme_opened" | "github_opened") {
    const key = `${project.repoId}:${kind}`;
    if (reported.current.has(key)) return;
    reported.current.add(key);
    void trackEvent({ repoId: project.repoId, kind }).catch(() => {});
  }

  const updated = formatRelative(project.pushedAt);
  const heroImage = readme?.images?.[0] ?? null;
  const body = readme?.readme ?? null;

  return (
    <section
      data-repo-id={project.repoId}
      className="flex min-h-[calc(100svh-104px)] snap-start snap-always items-center py-4 sm:py-7"
    >
      <article className="relative mx-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border bg-card">
        {heroImage && <HeroImage src={heroImage} alt={project.name} />}

        <div className="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-3 sm:px-8">
          <MetaLabel>№ {String(index).padStart(2, "0")}</MetaLabel>
          <MetaLabel>
            {project.discoveredVia
              ? `via ${project.discoveredVia}`
              : "discovery"}
          </MetaLabel>
        </div>

        <header className="flex items-start gap-4 px-5 pt-6 sm:px-8 sm:pt-7">
          <img
            src={`https://github.com/${project.owner}.png?size=96`}
            alt=""
            loading="lazy"
            decoding="async"
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-2xl border border-border bg-muted"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs tracking-wide text-muted-foreground">
              {project.owner}
            </p>
            <a
              href={project.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={() => report("github_opened")}
              className="block truncate text-2xl font-semibold tracking-tight underline-offset-4 hover:underline sm:text-[28px]"
            >
              {project.name}
            </a>
          </div>
          <Button variant="ghost" size="icon-sm" asChild>
            <a
              href={project.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={() => report("github_opened")}
              aria-label={`Open ${project.fullName} on GitHub`}
            >
              <ExternalLink className="size-4" />
            </a>
          </Button>
        </header>

        <div className="px-5 pt-5 sm:px-8">
          <p className="text-base leading-relaxed text-foreground/90 sm:text-lg">
            {project.description || "No description provided."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <LanguageDot language={project.language} />
            <span className="inline-flex items-center gap-1.5">
              <Star className="size-4" aria-hidden />
              {formatCompact(project.stars)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <GitFork className="size-4" aria-hidden />
              {formatCompact(project.forks)}
            </span>
            {project.starGrowth7d != null && project.starGrowth7d >= 40 && (
              <span className="inline-flex items-center gap-1.5 text-foreground">
                <TrendingUp className="size-4" aria-hidden />+
                {formatCompact(project.starGrowth7d)} this week
              </span>
            )}
            {project.license && <span>{project.license}</span>}
            {updated && <span>updated {updated}</span>}
            {project.archived && (
              <span className="text-foreground">Archived</span>
            )}
          </div>
          <TopicChips topics={project.topics} count={6} className="mt-4" />
          {project.reasons.length > 0 && (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/70">Why this: </span>
              {project.reasons.join(" · ")}
            </p>
          )}
        </div>

        <section className="mt-6 border-t border-border/70">
          <div className="flex items-center justify-between gap-3 px-5 py-3 sm:px-8">
            <MetaLabel>README</MetaLabel>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 px-2 text-xs"
              onClick={() => {
                report("readme_opened");
                setReadmeOpen(true);
              }}
              disabled={!body}
            >
              Full README
              <ArrowUpRight className="size-3.5" />
            </Button>
          </div>
          <div className="relative max-h-[32svh] overflow-hidden px-5 pb-9 sm:px-8">
            {body ? (
              <Markdown
                source={body}
                title={project.name}
                maxBlocks={14}
                hideImages={Boolean(heroImage)}
              />
            ) : readme === undefined ||
              (readme !== null && !readme.readmeLoaded) ? (
              <p className="flex min-h-40 items-center gap-2 py-4 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Pulling the README from GitHub…
              </p>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">
                This repository has no README — the description above is all
                GitHub gives us.
              </p>
            )}
            {body && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent"
              />
            )}
          </div>
        </section>

        <footer className="mt-auto flex flex-col gap-4 border-t border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex flex-col gap-1.5">
            <MetaLabel>How interesting?</MetaLabel>
            <InterestScale
              value={rating}
              autoAdvance
              onRated={onRated}
              onRate={(value) => {
                // Optimistic, but honest: a failed mutation restores the
                // rating that is actually stored.
                const previous = rating;
                setRating(value);
                void Promise.resolve(onRate(project.repoId, value)).then(
                  (ok) => {
                    if (ok === false) setRating(previous);
                  },
                );
              }}
              onClear={() => {
                const previous = rating;
                setRating(null);
                void Promise.resolve(onClear(project.repoId)).then((ok) => {
                  if (ok === false) setRating(previous);
                });
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              className="gap-1.5"
              onClick={() => onSkip(project.repoId)}
            >
              <EyeOff className="size-3.5" />
              Skip
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onPrevious}
              aria-label="Previous project"
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onNext}
              aria-label="Next project"
            >
              <ArrowDown className="size-4" />
            </Button>
          </div>
        </footer>
      </article>

      <Dialog open={readmeOpen} onOpenChange={setReadmeOpen}>
        <DialogContent
          data-readme-overlay=""
          className="flex max-h-[88svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl lg:max-w-7xl"
        >
          <DialogHeader className="shrink-0 gap-1 border-b border-border/70 px-6 py-5 pr-12 text-left">
            <MetaLabel>README</MetaLabel>
            <DialogTitle className="truncate text-lg tracking-tight">
              {project.fullName}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Full README for {project.fullName}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-6 py-6 sm:px-8">
            {body ? (
              <Markdown
                source={body}
                title={project.name}
                className="text-foreground/90"
              />
            ) : (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Loading README…
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
