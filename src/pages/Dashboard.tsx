import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import { Bookmark, ExternalLink, Star } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/app-header";
import { StarsImport } from "@/components/stars-import";
import { Loading } from "@/components/feed/loading";
import { InterestScale } from "@/components/feed/interest-scale";
import { LanguageDot, TopicChips } from "@/components/feed/project-parts";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { formatCompact, formatRelative } from "@/lib/format";

export default function Dashboard() {
  const saved = useQuery(api.feed.library, { kind: "saved" });
  const setSaved = useMutation(api.feed.setSaved);
  const setRating = useMutation(api.feed.setRating);
  const clearRating = useMutation(api.feed.clearRating);
  const projects = saved?.items ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader active="dashboard" />
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-12"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Your collection
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Saved projects
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {saved?.total ?? 0} projects you want to come back to.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/feed">Back to explore</Link>
          </Button>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Taste profile</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Import your GitHub stars — every starred project becomes an
              implicit rating, so the feed knows you immediately.
            </p>
          </div>
          <StarsImport />
        </div>

        {saved === undefined ? (
          <Loading label="Loading saved projects…" />
        ) : projects.length === 0 ? (
          <div className="py-20 text-center">
            <Bookmark className="mx-auto size-7 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-medium">Nothing saved yet</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              Save projects while exploring and they’ll be collected here.
            </p>
            <Button asChild className="mt-5">
              <Link to="/feed">Explore projects</Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {projects.map((project) => {
              const updated = formatRelative(project.pushedAt);
              return (
                <li
                  key={project.repoId}
                  className="flex flex-col gap-4 py-6 sm:flex-row sm:items-start sm:justify-between sm:gap-8"
                >
                  <div className="min-w-0 flex-1">
                    <a
                      href={project.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-lg font-semibold tracking-tight underline-offset-4 hover:underline"
                    >
                      {project.fullName}
                    </a>
                    <p className="mt-2 text-sm leading-relaxed text-foreground">
                      {project.description || "No description provided."}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                      <LanguageDot language={project.language} />
                      <span className="inline-flex items-center gap-1">
                        <Star className="size-3.5" />
                        {formatCompact(project.stars)}
                      </span>
                      {updated && <span>Updated {updated}</span>}
                      {project.rating && (
                        <span>Interest: {project.rating}/5</span>
                      )}
                    </div>
                    <TopicChips
                      topics={project.topics}
                      count={6}
                      className="mt-4"
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <InterestScale
                      value={project.rating}
                      onRate={(value) =>
                        void setRating({ repoId: project.repoId, value }).catch(
                          (error) =>
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : "Could not update rating.",
                            ),
                        )
                      }
                      onClear={() =>
                        void clearRating({ repoId: project.repoId }).catch(
                          (error) =>
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : "Could not clear rating.",
                            ),
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      onClick={() =>
                        void setSaved({
                          repoId: project.repoId,
                          saved: false,
                        }).catch((error) =>
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : "Could not remove saved project.",
                          ),
                        )
                      }
                    >
                      <Bookmark className="size-3.5 fill-current" />
                      Remove
                    </Button>
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
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </motion.main>
    </div>
  );
}
