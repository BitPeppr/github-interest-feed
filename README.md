# Gitbook

**Social media, but for GitHub.**

Gitbook is an endless feed of real open-source projects, one card at a time. Instead of posts, you scroll projects — each card arrives with its description, screenshots and README. Rate what you like, save what you'll come back to, skip the rest, and the feed quietly becomes yours.

There is no timeline to keep up with, nothing to post, and no algorithm you can't see the shape of. It is built for one person: you.

## What it does

### The feed (Explore)

- **One project at a time.** A reels-style feed drawing from all of GitHub, not a catalog page. Scroll, swipe or use the arrow keys; the next card is always ready before you reach it.
- **Every card is substantial.** Owner, description, stars, forks, license, last activity, topics — plus the first screenshot from the README and a preview of the README itself, inline on the card.
- **Full README on demand.** When the preview isn't enough, the complete document opens in a wide dialog — rendered safely, with images, code blocks and tables.
- **Rate in about a second.** A 1–5 interest scale on every card. Rating advances straight to the next project.
- **Save or skip.** Bookmark the keepers, dismiss the rest — and both decisions teach the feed.

### Your library (Saved)

Everything you bookmarked in one list: re-rate it, open it on GitHub, or remove it. Ratings and saves are yours alone.

### A feed that learns

The ranking is a small, legible system — roughly the shape of a modern social feed's recommender, adapted for repositories:

- **Taste, not just topics.** The topics, languages and authors you rate highly pull more of the same toward the top.
- **Negative signals count double.** A skip says more than a like: skips and 1–2 ratings push their topics, languages and authors down — decisively.
- **A slice reserved for discovery.** Every window keeps exploration slots for corners of GitHub you've never met, chosen from facets you've barely been shown. The slice cools down as the feed learns you.
- **Freshness over fame.** Star counts are capped in the score and recency fades with a half-life, so a brand-new zero-star gem can stand next to a 20k-star classic.
- **One ecosystem can't own your feed.** The window reranker penalises near-duplicate projects and decays repeated owners and languages, so a single project type can't flood the screen.

### Accounts

Sign up or log in with an email code, or start rating immediately as a guest. Either way you get a personal feed; the ratings you leave are what shape it.

## Try it

1. Sign in with an email code (or continue as a guest).
2. Scroll the feed — read the card, the README, whatever you need.
3. Rate ten projects. That's all the feed needs to start looking like yours.
4. Save the keepers; skip anything that isn't for you.
5. Check **Saved** whenever you want to come back to something.

---

# Architecture

- **Frontend:** Vite · React 19 · React Router v7 (import from `react-router`) · Tailwind CSS v4 · shadcn/ui · Lucide icons · Framer Motion · sonner
- **Backend & database:** Convex (queries, mutations, actions) with Convex Auth (email OTP + anonymous guest sessions)
- **Package manager:** Bun

All source lives under `src/`:

| Path | What lives there |
| --- | --- |
| `src/pages` | Landing, Feed (Explore), Dashboard (Saved), Auth |
| `src/components` | App chrome (`app-header`, `wordmark`), feed cards, shadcn primitives in `ui/` |
| `src/convex` | Schema, feed ranking (`feed.ts`), GitHub ingestion (`github.ts`), auth |
| `src/lib` | Safe Markdown renderer for READMEs, formatting helpers |

# Implementation

## Where projects come from

A shared Convex catalog stores repositories discovered through GitHub's search API (topic searches across a wide topic list, with rotating star bands so both small and famous projects surface). READMEs are pulled from GitHub's raw host — outside the API rate limit — and their embedded screenshots are extracted and kept with the repo, so cards can show a hero image without hot-linking a guess.

## The ranking pipeline

1. **Signals.** Every rating, save and skip becomes per-topic / per-language / per-author affinity (positive) or dislike (weighted heavier, negative).
2. **Scoring.** A single weighted sum per candidate — capped stars, freshness half-life, max-topic affinity, dislikes, an optimism term for under-exposed facets, a first-sighting boost, and a stable per-project jitter.
3. **Reranking.** A greedy pass assembles each window: Jaccard similarity between projects is penalised, repeated authors decay, and languages get a milder repeat decay.
4. **Interleaving.** Reserved exploration picks are spread evenly through the window instead of bunching at the end.

## No flash, no reflow

Cards are taller than the viewport and render image + README inline, so the feed keeps a warm pipeline: discovery batches are enriched in the background the moment they arrive (with retries), a six-card buffer holds live README subscriptions and pre-decodes hero images, and cards only mount once their payload is ready — each post paints fully assembled.

# Development

```sh
bun install
bunx convex dev        # starts the Convex backend and runs codegen
bun run dev            # starts the Vite dev server
```

Client environment variables (`CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`) are project-specific. The Convex deployment carries its own secrets (auth keys, and optionally `GITHUB_TOKEN` for higher GitHub API rate limits).

# Contributing

PRs and issues are welcome. The conventions that keep this codebase coherent:

**Auth** — the Convex auth files (`src/convex/auth.ts`, `auth.config.ts`, `auth/emailOtp.ts`) are fixed; don't modify them. Use `useAuth` from `@/hooks/use-auth` on the frontend and `getAuthUserId(ctx)` in every Convex function on the backend — the route guard is UX only, real authorization lives in the queries and mutations. New protected routes go behind `RequireAuth`, which explains the block and returns the user to the page they asked for.

**Convex** — schema in `src/convex/schema.ts` with `schemaValidation: false`; use `Doc<"Table">` / `Id<"Table">` types, no return type validators, and handle null results. External calls (HTTP) belong in actions.

**UI** — mobile responsive, always. No nested cards, no shadows — hairline borders instead. Spinners rather than skeleton loaders. Toasts via sonner for results and errors. Keep the theme in `src/index.css` tokens rather than hard-coding colors, and prefer the existing shadcn primitives in `src/components/ui`.
