import type { FunctionReturnType } from "convex/server";
import type { Doc } from "@/convex/_generated/dataModel";
import type { api } from "@/convex/_generated/api";

export type FeedData = NonNullable<FunctionReturnType<typeof api.feed.list>>;
export type FeedItem = FeedData["items"][number];
export type TopicDoc = Doc<"topics">;
