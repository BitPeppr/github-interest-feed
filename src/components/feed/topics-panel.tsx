import { useState } from "react";
import { Plus, X } from "lucide-react";

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
}

/**
 * Topics are optional: the discovery feed runs on its own, and following a
 * topic only tells it where to look first.
 */
export function TopicsPanel({
  topics,
  counts,
  onAdd,
  onRemove,
}: TopicsPanelProps) {
  const [draft, setDraft] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const lastSynced = topics.reduce<number | null>((latest, topic) => {
    if (!topic.lastSyncedAt) return latest;
    return latest === null
      ? topic.lastSyncedAt
      : Math.max(latest, topic.lastSyncedAt);
  }, null);

  const runAdd = async (value: string) => {
    if (!value || isAdding) return;
    setIsAdding(true);
    try {
      await onAdd(value);
      setDraft("");
    } finally {
      setIsAdding(false);
    }
  };

  const suggestions = SUGGESTED_TOPICS.filter(
    (topic) => !topics.some((entry) => entry.slug === topic),
  ).slice(0, 3);

  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <div className="flex items-baseline justify-between border-b pb-3">
        <h2 className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
          Topics you follow
        </h2>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {topics.length}
        </span>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Optional. Your feed fills itself from all over GitHub — topics just tell
        it where to look first.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void runAdd(draft.trim());
        }}
        className="mt-4 flex gap-2"
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="e.g. webassembly"
          aria-label="Follow a topic"
          className="h-9 text-sm"
          disabled={isAdding}
        />
        <Button
          type="submit"
          variant="outline"
          size="icon"
          aria-label="Follow topic"
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
              onClick={() => void runAdd(topic)}
              disabled={isAdding}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-50"
            >
              + {topic}
            </button>
          ))}
        </div>
      )}

      {topics.length > 0 ? (
        <>
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
                        : `${count} project${count === 1 ? "" : "s"} from this topic`}
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
          {lastSynced && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Last fetched {formatRelative(lastSynced)}
            </p>
          )}
        </>
      ) : (
        <p className="mt-5 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
          No topics followed. The feed still fills itself — it looks at what you
          rate as you go.
        </p>
      )}
    </aside>
  );
}
