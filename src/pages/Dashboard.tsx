import { useCallback, useState } from "react";
import { Link } from "react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import { Bookmark, ExternalLink, Eye, Star } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/app-header";
import { InterestScale } from "@/components/feed/interest-scale";
import { Loading } from "@/components/feed/loading";
import { TopicsPanel } from "@/components/feed/topics-panel";
import type { LibraryKind, Project, TopicDoc } from "@/components/feed/types";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/convex/_generated/api";
import { useRatings } from "@/hooks/use-ratings";
import { errorText, formatCompact, formatRelative } from "@/lib/format";

const TABS: { key: LibraryKind; label: string }[] = [
  { key: "saved", label: "Saved" },
  { key: "rated", label: "Rated" },
  { key: "hidden", label: "Hidden" },
];

const EMPTY_COPY: Record<LibraryKind, string> = {
  saved:
    "Nothing saved yet. Tap Save on a card in your feed and it waits for you here.",
  rated: "No ratings yet. Rate a few cards and they collect here.",
  hidden:
    "Nothing hidden. Projects you dismiss from the feed are kept here in case you change your mind.",
};

function LibraryRow({
  project,
  action,
  onRate,
  onClear,
}: {
  project: Project;
  action?: React.ReactNode;
  onRate: (repoId: number, value: number) => void;
  onClear: (repoId: number) => void;
}) {
  const updated = formatRelative(project.pushedAt);

  return (
    <li className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="min-w-0 flex-1">
        <a
          href={project.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex max-w-full items-baseline text-sm font-medium tracking-[-0.01em] underline-offset-4 hover:underline"
        >
          <span className="truncate">
            <span className="text-muted-foreground">{project.owner}</span>
            <span className="text-muted-foreground/50"> / </span>
            {project.name}
          </span>
        </a>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {project.language && (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-foreground/50"
              />
              {project.language}
            </span>
          )}
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Star className="size-3.5" aria-hidden />
            {formatCompact(project.stars)}
          </span>
          {updated && <span>Updated {updated}</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <InterestScale
          value={project.rating}
          onRate={(value) => onRate(project.repoId, value)}
          onClear={() => onClear(project.repoId)}
        />
        {action}
      </div>
    </li>
  );
}

export default function Dashboard() {
  const stats = useQuery(api.feed.stats);
  const topics = useQuery(api.feed.listTopics);
  const [kind, setKind] = useState<LibraryKind>("saved");
  const library = useQuery(api.feed.library, { kind });

  const addTopic = useMutation(api.feed.addTopic);
  const removeTopic = useMutation(api.feed.removeTopic);
  const setSaved = useMutation(api.feed.setSaved);
  const setHidden = useMutation(api.feed.setHidden);
  const syncTopic = useAction(api.github.syncTopic);
  const { rate, clear } = useRatings();

  const handleAddTopic = useCallback(
    async (raw: string) => {
      let slug: string;
      try {
        const result = await addTopic({ topic: raw });
        slug = result.slug;
        if (!result.created) {
          toast(`You already follow “${slug}”.`);
          return;
        }
      } catch (error) {
        toast.error(errorText(error));
        return;
      }

      try {
        const result = await syncTopic({ topic: slug });
        if (result.error) {
          toast.error(result.error);
        } else {
          toast.success(
            `“${slug}” now steers your feed. ${result.fetched} projects fetched.`,
          );
        }
      } catch (error) {
        toast.error(errorText(error));
      }
    },
    [addTopic, syncTopic],
  );

  const handleRemoveTopic = useCallback(
    (topicId: TopicDoc["_id"]) => {
      void removeTopic({ topicId }).catch((error) =>
        toast.error(errorText(error)),
      );
    },
    [removeTopic],
  );

  const handleUnsave = useCallback(
    (repoId: number) => {
      void setSaved({ repoId, saved: false }).catch((error) =>
        toast.error(errorText(error)),
      );
    },
    [setSaved],
  );

  const handleRestore = useCallback(
    (repoId: number) => {
      void setHidden({ repoId, hidden: false })
        .then(() => toast.success("Back in your feed."))
        .catch((error) => toast.error(errorText(error)));
    },
    [setHidden],
  );

  const counts: Record<string, number> = stats?.counts ?? {};
  const isLoading = stats === undefined || topics === undefined;

  const cards = [
    { label: "In your catalog", value: String(stats?.catalogSize ?? 0) },
    { label: "Unseen", value: String(stats?.unseen ?? 0) },
    { label: "Rated", value: String(stats?.rated ?? 0) },
    {
      label: "Average interest",
      value: stats?.averageInterest
        ? stats.averageInterest.toFixed(1)
        : "—",
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader active="dashboard" />

      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="mx-auto w-full max-w-6xl px-6 py-10 lg:py-12"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              Your dashboard
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              How much you have rated, what you saved, and the topics nudging
              your feed.
            </p>
          </div>
          <Button className="gap-2" asChild>
            <Link to="/feed">Open your feed</Link>
          </Button>
        </div>

        {isLoading ? (
          <Loading label="Loading your dashboard…" />
        ) : (
          <>
            <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
              {cards.map((card) => (
                <div key={card.label} className="bg-background px-5 py-4">
                  <dt className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                    {card.label}
                  </dt>
                  <dd className="mt-2 text-2xl font-semibold tracking-[-0.02em] tabular-nums">
                    {card.value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-10 grid gap-10 lg:grid-cols-[236px_minmax(0,1fr)] lg:gap-14">
              <TopicsPanel
                topics={topics ?? []}
                counts={counts}
                onAdd={handleAddTopic}
                onRemove={handleRemoveTopic}
              />

              <section>
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
                  <div>
                    <h2 className="text-lg font-semibold tracking-[-0.015em]">
                      Your library
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {stats?.saved ?? 0} saved · {stats?.rated ?? 0} rated ·{" "}
                      {stats?.hidden ?? 0} hidden
                    </p>
                  </div>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={kind}
                    onValueChange={(value) => {
                      if (value) setKind(value as LibraryKind);
                    }}
                  >
                    {TABS.map((tab) => (
                      <ToggleGroupItem key={tab.key} value={tab.key}>
                        {tab.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>

                {library === undefined || library === null ? (
                  <Loading label="Loading your library…" />
                ) : library.items.length === 0 ? (
                  <p className="max-w-md py-12 text-sm leading-relaxed text-muted-foreground">
                    {EMPTY_COPY[kind]}
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {library.items.map((project) => (
                      <LibraryRow
                        key={project.repoId}
                        project={project}
                        onRate={rate}
                        onClear={clear}
                        action={
                          kind === "hidden" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              onClick={() => handleRestore(project.repoId)}
                            >
                              <Eye className="size-3.5" />
                              Restore
                            </Button>
                          ) : kind === "saved" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1.5 text-muted-foreground hover:text-foreground"
                              onClick={() => handleUnsave(project.repoId)}
                            >
                              <Bookmark className="size-3.5" />
                              Remove
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1.5 text-muted-foreground hover:text-foreground"
                              asChild
                            >
                              <a
                                href={project.url}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                <ExternalLink className="size-3.5" />
                                GitHub
                              </a>
                            </Button>
                          )
                        }
                      />
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </motion.main>
    </div>
  );
}
