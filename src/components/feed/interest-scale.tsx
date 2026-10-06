import { useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/** 1-5 interest scale. Labels show in the tooltip and next to the dots. */
export const INTEREST_LABELS = [
  "Not for me",
  "Curious",
  "Interested",
  "Keen",
  "Love it",
] as const;

const LEVELS = [1, 2, 3, 4, 5];

interface InterestScaleProps {
  value: number | null;
  onRate: (value: number) => void;
  onClear: () => void;
}

/**
 * Five dots, filled up to the chosen level. Hovering previews a level without
 * committing it, so the control stays quiet until the user decides.
 */
export function InterestScale({ value, onRate, onClear }: InterestScaleProps) {
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? value ?? 0;
  const label = value ? INTEREST_LABELS[value - 1] : "Rate";

  return (
    <div className="flex items-center gap-3">
      <div
        role="radiogroup"
        aria-label="Interest in this project"
        className="flex items-center gap-1"
        onMouseLeave={() => setPreview(null)}
      >
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={value === level}
            aria-label={`${level} of 5 — ${INTEREST_LABELS[level - 1]}`}
            title={`${level} of 5 — ${INTEREST_LABELS[level - 1]}`}
            onMouseEnter={() => setPreview(level)}
            onFocus={() => setPreview(level)}
            onBlur={() => setPreview(null)}
            onClick={() => onRate(level)}
            className={cn(
              "flex size-5 items-center justify-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
              value === level
                ? "border-foreground"
                : "border-border hover:border-foreground/40",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-2 rounded-full transition-colors",
                level <= shown ? "bg-foreground" : "bg-transparent",
              )}
            />
          </button>
        ))}
      </div>

      <span className="w-[68px] truncate text-xs text-muted-foreground tabular-nums">
        {label}
      </span>

      <button
        type="button"
        onClick={onClear}
        aria-label="Clear rating"
        title="Clear rating"
        className={cn(
          "flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
          value === null && "invisible",
        )}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
