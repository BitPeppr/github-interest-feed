import { useCallback, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/app-header";
import { Loading } from "@/components/feed/loading";
import { RepoRow } from "@/components/feed/repo-row";
import { TopicsPanel } from "@/components/feed/topics-panel";
import type { FeedItem, TopicDoc } from "@/components/feed/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/convex/_generated/api";
import { useRatings } from "@/hooks/use-ratings";
import { errorText } from "@/lib/format";
import { SUGGESTED_TOPICS } from "@/lib/topics";

type FilterKey = "all" | "unrated" | "rated";
type SortKey = "active" | "stars" | "added";

const SORT_LABELS: Record<SortKey, string> = {
  active: "Recently active",
  stars: "Most stars",
  added: "Recently added",
};

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
      {children}
    </p>
  );
}

export default function Dashboard() {
  const topics = useQuery(api.feed.listTopics);
  const data = useQuery(api.feed.list);

  const addTopic = useMutation(api.feed.addTopic);
  const removeTopic = useMutation(api.feed.removeTopic);
  const syncTopic = useAction(api.github.syncTopic);
  const syncAllTopics = useAction(api.github.syncAllTopics);
  const { rate, clear } = useRatings();

  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("active");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [draft, setDraft] = useState("");

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const { results } = await syncAllTopics({});
      const failed = results.filter((result) => result.error);
      const added = results.reduce((sum, result) => sum + result.added, 0);
      if (failed.length > 0) {
        toast.error(failed[0].error ?? "Some topics could not be fetched.");
      } else {
        toast.success(
          added > 0
            ? `Found ${added} new project${added === 1 ? "" : "s"}.`
            : "Your feed is already up to date.",
        );
      }
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setIsRefreshing(false);
    }
  }, [syncAllTopics]);

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

      setIsRefreshing(true);
      try {
        const result = await syncTopic({ topic: slug });
        if (result.error) {
          toast.error(result.error);
        } else {
          toast.success(
            result.added > 0
              ? `“${slug}” — ${result.added} project${result.added === 1 ? "" : "s"} added.`
              : `“${slug}” — nothing new right now.`,
          );
        }
      } catch (error) {
        toast.error(errorText(error));
      } finally {
        setIsRefreshing(false);
      }
    },
    [addTopic, syncTopic],
  );

  const submitDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    setDraft("");
    await handleAddTopic(value);
  };

  const handleRemoveTopic = useCallback(
    (topicId: TopicDoc["_id"]) => {
      void removeTopic({ topicId }).catch((error) =>
        toast.error(errorText(error)),
      );
    },
    [removeTopic],
  );

  const items = useMemo<FeedItem[]>(() => {
    const all = data?.items ?? [];
    const filtered =
      filter === "rated"
        ? all.filter((item) => item.rating !== null)
        : filter === "unrated"
          ? all.filter((item) => item.rating === null)
          : all;

    return [...filtered].sort((a, b) => {
      if (filter === "rated") {
        return (b.rating ?? 0) - (a.rating ?? 0) || b.stars - a.stars;
      }
      if (sort === "stars") return b.stars - a.stars;
      if (sort === "added") return b.firstSeenAt - a.firstSeenAt;
      return (b.pushedAt ?? 0) - (a.pushedAt ?? 0);
    });
  }, [data, filter, sort]);

  const ratedItems = useMemo(
    () => (data?.items ?? []).filter((item) => item.rating !== null),
    [data],
  );

  const isLoading = topics === undefined || data === undefined;
  const topicCount = topics?.length ?? 0;

  const averageInterest =
    ratedItems.length > 0
      ? ratedItems.reduce((sum, item) => sum + (item.rating ?? 0), 0) /
        ratedItems.length
      : null;

  const stats = [
    { label: "In your feed", value: String(data?.total ?? 0) },
    { label: "Topics", value: String(topicCount) },
    { label: "Rated", value: String(ratedItems.length) },
    {
      label: "Average interest",
      value: averageInterest === null ? "—" : averageInterest.toFixed(1),
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
        {isLoading ? (
          <Loading label="Loading your feed…" />
        ) : topicCount === 0 ? (
          <section className="mx-auto max-w-xl py-10 text-center">
            <MicroLabel>Version 1</MicroLabel>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.025em] text-balance">
              Start with a topic or two.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Your feed only contains projects from the topics you choose here.
              Add one and GitHub Interest Feed fetches the most-starred projects
              under it, ready for you to rate.
            </p>

            <form onSubmit={submitDraft} className="mt-8 flex gap-2">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Add a GitHub topic, e.g. rust"
                aria-label="Add a GitHub topic"
                className="h-10"
                disabled={isRefreshing}
              />
              <Button
                type="submit"
                className="h-10 shrink-0 gap-2"
                disabled={isRefreshing || draft.trim().length === 0}
              >
                {isRefreshing ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <Plus className="size-4" />
                )}
                Add topic
              </Button>
            </form>

            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {SUGGESTED_TOPICS.slice(0, 5).map((topic) => (
                <button
                  key={topic}
                  type="button"
                  disabled={isRefreshing}
                  onClick={() => void handleAddTopic(topic)}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-50"
                >
                  {topic}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-[-0.02em]">
                  Your dashboard
                </h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Your topics, your feed, and every rating you have given.
                </p>
              </div>
            </div>

            <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
              {stats.map((stat) => (
                <div key={stat.label} className="bg-background px-5 py-4">
                  <dt className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                    {stat.label}
                  </dt>
                  <dd className="mt-2 text-2xl font-semibold tracking-[-0.02em] tabular-nums">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-10 grid gap-10 lg:grid-cols-[236px_minmax(0,1fr)] lg:gap-14">
              <TopicsPanel
                topics={topics ?? []}
                counts={data?.counts ?? {}}
                onAdd={handleAddTopic}
                onRemove={handleRemoveTopic}
                onRefresh={() => void refreshAll()}
                isRefreshing={isRefreshing}
              />

              <section>
                <div className="flex flex-wrap items-end justify-between gap-6 border-b border-border pb-4">
                  <div>
                    <h2 className="text-lg font-semibold tracking-[-0.015em]">
                      Your feed
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {data?.total ?? 0} project
                      {(data?.total ?? 0) === 1 ? "" : "s"} from {topicCount}{" "}
                      topic{topicCount === 1 ? "" : "s"} · {ratedItems.length}{" "}
                      rated
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      size="sm"
                      value={filter}
                      onValueChange={(value) => {
                        if (value) setFilter(value as FilterKey);
                      }}
                    >
                      <ToggleGroupItem value="all">All</ToggleGroupItem>
                      <ToggleGroupItem value="unrated">Unrated</ToggleGroupItem>
                      <ToggleGroupItem value="rated">Rated</ToggleGroupItem>
                    </ToggleGroup>

                    {filter !== "rated" && (
                      <Select
                        value={sort}
                        onValueChange={(value) => setSort(value as SortKey)}
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-[168px] text-xs"
                          aria-label="Sort feed"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                            <SelectItem key={key} value={key}>
                              {SORT_LABELS[key]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>

                <p className="pt-4 pb-1 text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
                  Rate 1 – 5 · 1 not for me · 5 love it
                </p>

                {data && data.total === 0 ? (
                  isRefreshing ? (
                    <Loading label="Fetching projects from GitHub…" />
                  ) : (
                    <div className="mt-4 rounded-lg border border-dashed border-border px-6 py-10 text-center">
                      <p className="text-sm font-medium">Nothing fetched yet</p>
                      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                        Fetch now and GitHub returns the most-starred projects
                        under your topics. Everything it returns stays in your
                        catalog.
                      </p>
                      <Button
                        className="mt-5 gap-2"
                        onClick={() => void refreshAll()}
                      >
                        Fetch projects
                      </Button>
                    </div>
                  )
                ) : items.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    {filter === "unrated"
                      ? "Every project in your feed has a rating. Add another topic for more."
                      : "No rated projects yet. Rate something and it lands here."}
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {items.map((item) => (
                      <RepoRow
                        key={item.repoId}
                        item={item}
                        onRate={rate}
                        onClear={clear}
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
