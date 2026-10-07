import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // Topics the signed-in user wants to discover projects from.
    topics: defineTable({
      userId: v.id("users"),
      slug: v.string(), // normalized GitHub topic, e.g. "machine-learning"
      createdAt: v.number(),
      lastSyncedAt: v.optional(v.number()),
      lastSyncError: v.optional(v.string()),
    })
      .index("by_user", ["userId"])
      .index("by_user_slug", ["userId", "slug"]),

    // Cached GitHub projects, shared across users. The discovery action fills
    // this in; READMEs and screenshots are pulled in lazily per project.
    repos: defineTable({
      repoId: v.number(), // GitHub numeric id
      fullName: v.string(),
      owner: v.string(),
      name: v.string(),
      description: v.optional(v.string()),
      url: v.string(),
      homepage: v.optional(v.string()),
      stars: v.number(),
      forks: v.number(),
      openIssues: v.number(),
      language: v.optional(v.string()),
      topics: v.array(v.string()),
      license: v.optional(v.string()),
      pushedAt: v.optional(v.number()),
      archived: v.boolean(),
      discoveredVia: v.array(v.string()), // what turned this project up (topics)
      firstSeenAt: v.number(),
      updatedAt: v.number(),
      readme: v.optional(v.string()), // raw markdown, truncated
      images: v.optional(v.array(v.string())), // screenshots found in the readme
      readmeFetchedAt: v.optional(v.number()),
      starGrowth7d: v.optional(v.number()), // stars gained vs ~a week ago
      starAccel: v.optional(v.number()), // growth speeding up (+) or fading (-)
    }).index("by_repo_id", ["repoId"]),

    // Daily star counts, diffed against each other so projects can rank by
    // growth velocity instead of raw size.
    starHistory: defineTable({
      repoId: v.number(),
      day: v.string(), // YYYY-MM-DD (UTC)
      stars: v.number(),
    })
      .index("by_repo_day", ["repoId", "day"])
      .index("by_day", ["day"]),

    // User-curated shelves of projects. Public ones are shareable by link.
    collections: defineTable({
      userId: v.id("users"),
      name: v.string(),
      description: v.optional(v.string()),
      repoIds: v.array(v.number()),
      isPublic: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_user", ["userId"]),

    // Public profile opt-in: the shelf shown at /u/:userId.
    profiles: defineTable({
      userId: v.id("users"),
      isPublic: v.boolean(),
      bio: v.optional(v.string()),
      updatedAt: v.number(),
    }).index("by_user", ["userId"]),

    // One row per (user, project) the user has touched. A row with no `value`
    // means the project was shown but not rated yet.
    ratings: defineTable({
      userId: v.id("users"),
      repoId: v.number(),
      value: v.optional(v.number()), // 1-5 interest
      implicit: v.optional(v.boolean()), // imported taste profile (e.g. stars)
      saved: v.optional(v.boolean()),
      hidden: v.optional(v.boolean()),
      seenAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_repo", ["userId", "repoId"]),

    // Where each user's endless feed has got to while walking its sources.
    feedState: defineTable({
      userId: v.id("users"),
      step: v.number(),
      updatedAt: v.number(),
    }).index("by_user", ["userId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
