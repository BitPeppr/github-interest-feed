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

    // Cached GitHub repositories, shared across topics (and users).
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
      discoveredVia: v.array(v.string()), // topic slugs this repo was found through
      firstSeenAt: v.number(),
      updatedAt: v.number(),
    }).index("by_repo_id", ["repoId"]),

    // How interested the user is in a project (1-5).
    ratings: defineTable({
      userId: v.id("users"),
      repoId: v.number(),
      value: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_repo", ["userId", "repoId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
