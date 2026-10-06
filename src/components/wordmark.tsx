import { cn } from "@/lib/utils";

/** Monochrome wordmark: a four-cell grid, sifted. */
export function Wordmark({
  className,
  showName = true,
}: {
  className?: string;
  showName?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className="grid size-4 shrink-0 grid-cols-2 grid-rows-2 gap-[2px]"
      >
        <span className="rounded-[1px] bg-foreground" />
        <span className="rounded-[1px] border border-foreground/25" />
        <span className="rounded-[1px] border border-foreground/25" />
        <span className="rounded-[1px] bg-foreground/35" />
      </span>
      {showName && (
        <span className="text-[15px] font-semibold tracking-[-0.015em]">
          Sift
        </span>
      )}
    </span>
  );
}
