import type { FunctionReturnType } from "convex/server";
import type { Doc } from "@/convex/_generated/dataModel";
import type { api } from "@/convex/_generated/api";

export type FeedData = NonNullable<FunctionReturnType<typeof api.feed.list>>;
export type CatalogData = NonNullable<
  FunctionReturnType<typeof api.feed.catalog>
>;

/** Projects are rendered from the same shape on both the dashboard and catalog. */
export type Project = FeedData["items"][number] | CatalogData["items"][number];
export type FeedItem = FeedData["items"][number];
export type TopicDoc = Doc<"topics">;
