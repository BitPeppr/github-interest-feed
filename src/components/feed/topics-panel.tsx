import { useState } from "react";
import { Plus, RefreshCw, X } from "lucide-react";

import type { TopicDoc } from "@/components/feed/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatRelative } from "@/lib/format";
import { SUGGESTED_TOPICS } from "@/lib/topics";
import { cn } from "@/lib/utils";

interface TopicsPanelProps {
  topics: TopicDoc[];
  counts: Record<string, number>;
  onAdd: (raw: string) => Promise<void>;
  onRemove: (topicId: TopicDoc["_id"]) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

/** Left rail on the dashboard: the topics that shape the feed. */
export function TopicsPanel({
  topics,
  counts,
  onAdd,
  onRemove,
  onRefresh,
  isRefreshing,
}: TopicsPanelProps) {
  const [draft, setDraft] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const lastSynced = topics.reduce<number | null>((latest, topic) => {
    if (!topic.lastSyncedAt) return latest;
    return latest === null
      ? topic.lastSyncedAt
      : Math.max(latest, topic.lastSyncedAt);
  }, null);
  const failed = topics.filter((topic) => topic.lastSyncError);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value || isAdding) return;
    setIsAdding(true);
    try {
      await onAdd(value);
      setDraft("");
    } finally {
      setIsAdding(false);
    }
  };

  const quickAdd = async (topic: string) => {
    if (isAdding) return;
    setIsAdding(true);
    try {
      await onAdd(topic);
    } finally {
      setIsAdding(false);
    }
  };

  const suggestions = SUGGESTED_TOPICS.filter(
    (topic) => !topics.some((t) => t.slug === topic),
  ).slice(0, 3);

  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <div className="flex items-baseline justify-between border-b pb-3">
        <h2 className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
          Your topics
        </h2>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {topics.length}
        </span>
      </div>

      <form onSubmit={submit} className="mt-4 flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="e.g. webassembly"
          aria-label="Add a topic"
          className="h-9 text-sm"
          disabled={isAdding}
        />
        <Button
          type="submit"
          variant="outline"
          size="icon"
          aria-label="Add topic"
          disabled={isAdding || draft.trim().length === 0}
        >
          {isAdding ? <Spinner /> : <Plus className="size-4" />}
        </Button>
      </form>

      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {suggestions.map((topic) => (
            <button
              key={topic}
              type="button"
              onClick={() => void quickAdd(topic)}
              disabled={isAdding}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-50"
            >
              + {topic}
            </button>
          ))}
        </div>
      )}

      {topics.length > 0 && (
        <ul className="mt-5 divide-y divide-border border-y border-border">
          {topics.map((topic) => {
            const count = counts[topic.slug] ?? 0;
            return (
              <li
                key={topic._id}
                className="group flex items-center justify-between gap-2 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium tracking-[-0.01em]">
                    {topic.slug}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-[11px] text-muted-foreground tabular-nums",
                      topic.lastSyncError && "text-foreground",
                    )}
                  >
                    {topic.lastSyncError
                      ? "Last fetch failed"
                      : `${count} project${count === 1 ? "" : "s"}`}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Stop following ${topic.slug}`}
                  title={`Stop following ${topic.slug}`}
                  onClick={() => onRemove(topic._id)}
                  className="text-muted-foreground transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {topics.length > 0 && (
        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Spinner className="size-3.5" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {isRefreshing ? "Fetching…" : "Fetch new projects"}
          </Button>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {failed.length > 0
              ? failed[0].lastSyncError
              : lastSynced
                ? `Last fetched ${formatRelative(lastSynced)}`
                : "Not fetched yet"}
          </p>
        </div>
      )}
    </aside>
  );
}
