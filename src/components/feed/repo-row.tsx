import { GitFork, Star } from "lucide-react";

import { InterestScale } from "@/components/feed/interest-scale";
import type { Project } from "@/components/feed/types";
import { formatCompact, formatRelative } from "@/lib/format";

interface RepoRowProps {
  item: Project;
  onRate: (repoId: number, value: number) => void;
  onClear: (repoId: number) => void;
}

/** One project in the feed: identity, quiet metadata, interest control. */
export function RepoRow({ item, onRate, onClear }: RepoRowProps) {
  const updated = formatRelative(item.pushedAt);

  return (
    <li className="group flex flex-col gap-4 py-5 sm:flex-row sm:items-start sm:justify-between sm:gap-10">
      <div className="min-w-0 flex-1">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex max-w-full items-baseline text-[15px] font-medium tracking-[-0.01em] underline-offset-4 hover:underline"
        >
          <span className="truncate">
            <span className="text-muted-foreground">{item.owner}</span>
            <span className="text-muted-foreground/50"> / </span>
            <span>{item.name}</span>
          </span>
        </a>

        {item.description ? (
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {item.description}
          </p>
        ) : (
          <p className="mt-1.5 text-sm text-muted-foreground/60">
            No description.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {item.language && (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-foreground/50"
              />
              {item.language}
            </span>
          )}
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Star className="size-3.5" aria-hidden />
            {formatCompact(item.stars)}
          </span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <GitFork className="size-3.5" aria-hidden />
            {formatCompact(item.forks)}
          </span>
          {updated && <span>Updated {updated}</span>}
          {item.archived && (
            <span className="rounded-full border px-2 py-0.5 text-[11px]">
              archived
            </span>
          )}
        </div>

        {item.topics.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.topics.slice(0, 3).map((topic) => (
              <span
                key={topic}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {topic}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 sm:pt-0.5">
        <InterestScale
          value={item.rating}
          onRate={(value) => onRate(item.repoId, value)}
          onClear={() => onClear(item.repoId)}
        />
      </div>
    </li>
  );
}
