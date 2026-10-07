import type { FunctionReturnType } from "convex/server";
import type { Doc } from "@/convex/_generated/dataModel";
import type { api } from "@/convex/_generated/api";

export type DiscoveryData = NonNullable<
  FunctionReturnType<typeof api.feed.discovery>
>;
export type ProjectsData = NonNullable<
  FunctionReturnType<typeof api.feed.projects>
>;
export type LibraryData = NonNullable<
  FunctionReturnType<typeof api.feed.library>
>;
export type StatsData = NonNullable<FunctionReturnType<typeof api.feed.stats>>;
export type CatalogData = NonNullable<
  FunctionReturnType<typeof api.feed.catalog>
>;
export type QueueData = NonNullable<FunctionReturnType<typeof api.queue.peek>>;

/** Every project row and card renders from this shape. */
export type Project = ProjectsData["items"][number];
/** A card served from the persisted queue (same shape, stored reasons). */
export type QueuedCard = QueueData["cards"][number];
export type TopicDoc = Doc<"topics">;
export type LibraryKind = "saved" | "rated" | "hidden";
