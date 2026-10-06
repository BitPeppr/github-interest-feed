import { Spinner } from "@/components/ui/spinner";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-20 text-sm text-muted-foreground">
      <Spinner className="size-4" />
      {label}
    </div>
  );
}
