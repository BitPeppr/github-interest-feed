import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { LogOut, Plus } from "lucide-react";
import { toast } from "sonner";

import { RepoRow } from "@/components/feed/repo-row";
import { TopicsPanel } from "@/components/feed/topics-panel";
import type { FeedItem, TopicDoc } from "@/components/feed/types";
import { Wordmark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { errorText } from "@/lib/format";
import { SUGGESTED_TOPICS } from "@/lib/topics";

type FilterKey = "all" | "unrated" | "rated";
type SortKey = "active" | "stars" | "added";

const SORT_LABELS: Record<SortKey, string> = {
  active: "Recently active",
  stars: "Most stars",
  added: "Recently added",
};

function FeedSkeleton() {
  return (
    <ul className="divide-y divide-border">
      {[0, 1, 2, 3].map((index) => (
        <li
          key={index}
          className="flex items-start justify-between gap-10 py-5"
        >
          <div className="flex-1 space-y-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-full max-w-md" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-5 w-36 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
      {children}
    </p>
  );
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const topics = useQuery(api.feed.listTopics);
  const data = useQuery(api.feed.list);

  const addTopic = useMutation(api.feed.addTopic);
  const removeTopic = useMutation(api.feed.removeTopic);
  const setRating = useMutation(api.feed.setRating);
  const clearRating = useMutation(api.feed.clearRating);
  const syncTopic = useAction(api.github.syncTopic);
  const syncAllTopics = useAction(api.github.syncAllTopics);

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
          toast(`Already following “${slug}”.`);
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

  const handleRate = useCallback(
    (repoId: number, value: number) => {
      void setRating({ repoId, value }).catch((error) =>
        toast.error(errorText(error)),
      );
    },
    [setRating],
  );

  const handleClear = useCallback(
    (repoId: number) => {
      void clearRating({ repoId }).catch((error) =>
        toast.error(errorText(error)),
      );
    },
    [clearRating],
  );

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

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

  const isLoading = topics === undefined || data === undefined;
  const topicCount = topics?.length ?? 0;
  const ratedCount = data?.rated ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Wordmark />
            <span className="hidden h-4 w-px bg-border sm:block" />
            <span className="hidden text-[11px] tracking-[0.16em] text-muted-foreground uppercase sm:block">
              Interest feed
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-[220px] truncate text-xs text-muted-foreground sm:block">
              {user?.email ?? "Guest session"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground hover:text-foreground"
              onClick={() => void handleSignOut()}
            >
              <LogOut className="size-3.5" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 py-10 lg:py-14">
        {isLoading ? (
          <FeedSkeleton />
        ) : topicCount === 0 ? (
          <section className="mx-auto max-w-xl py-10 text-center">
            <MicroLabel>Version 1</MicroLabel>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.025em] text-balance">
              Pick a few topics. Rate what shows up.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Your feed only contains projects from the topics you choose here —
              nothing scraped, nothing social. Rate a project 1 to 5 and that
              signal stays yours.
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
          <div className="grid gap-10 lg:grid-cols-[236px_minmax(0,1fr)] lg:gap-14">
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
                  <h1 className="text-2xl font-semibold tracking-[-0.02em]">
                    Your feed
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {data?.total ?? 0} project
                    {(data?.total ?? 0) === 1 ? "" : "s"} from {topicCount} topic
                    {topicCount === 1 ? "" : "s"}
                    {ratedCount > 0 ? ` · ${ratedCount} rated` : ""}
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
                  <FeedSkeleton />
                ) : (
                  <div className="mt-4 rounded-lg border border-dashed border-border px-6 py-10 text-center">
                    <p className="text-sm font-medium">
                      Nothing fetched yet
                    </p>
                    <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                      Nothing has been fetched for these topics yet. Fetch now
                      to pull in the first batch of projects.
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
                    ? "Every project in your feed has a rating. Add a topic for more."
                    : "No rated projects yet. Rate something and it lands here."}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((item) => (
                    <RepoRow
                      key={item.repoId}
                      item={item}
                      onRate={handleRate}
                      onClear={handleClear}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
