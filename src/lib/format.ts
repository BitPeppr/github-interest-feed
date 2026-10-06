import { formatDistanceToNowStrict } from "date-fns";

function trimZero(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

/** 842 -> "842", 1240 -> "1.2k", 26400 -> "26k", 4200000 -> "4.2m" */
export function formatCompact(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10_000) return `${trimZero(value / 1000)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${trimZero(value / 1_000_000)}m`;
}

/** "3 days ago", or null when the timestamp is missing. */
export function formatRelative(
  timestamp: number | null | undefined,
): string | null {
  if (!timestamp) return null;
  return formatDistanceToNowStrict(new Date(timestamp), { addSuffix: true });
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong. Try again.";
}
