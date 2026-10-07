# Recommendation architecture

How the discovery feed learns taste, where each piece lives, and how to
change ranking without breaking it.

## Loop

```text
rate / save / open / dwell
  → interactionEvents (history) + ratings (state) + userRecProfiles (taste)
  → queue generator (background action, when the queue runs shallow)
  → feedQueue (persisted cards with reasons + provenance)
  → peek / consume (bounded serving reads)
  → card ("Why this" from the real ranking path)
```

## Modules (`src/convex/recommender/`)

| Module | Owns | Never touches |
|---|---|---|
| `types.ts` | boundary shapes, features, provenance | database, network |
| `constants.ts` | every weight, cap and threshold | — |
| `signals.ts` | affinities/dislikes/exposure from history | database |
| `profile.ts` | incremental taste updates (+ parity proof) | database |
| `scoring.ts` | feature measurement + weighted sum + trace | database |
| `exploration.ts` | independent novelty retrieval | exploitation scores |
| `rerank.ts` | facet MMR + interleave | vectors |
| `vectors.ts` | cosine, clusters, per-cluster retrieval, semantic MMR | database |
| `repotext.ts` | canonical embed text, README cleaning, hashing | network |
| `candidates.ts` | metadata generators, dedupe, query assembly | vectors |
| `queueplan.ts` | pure queue-batch planning | database, network |
| `explain.ts` | reasons from provenance + features + signals | anything else |
| `eval.ts` | replay metrics, slate diagnostics, JSON loader | production code paths |

Convex glue lives in `feed.ts` (queries/mutations), `queue.ts` (peek/
consume/generate), `embeddings.ts` (backfill pipeline) and
`lib/embeddings.ts` (provider). Pure modules are imported by Convex
functions via relative paths and are fully covered by vitest
(`npm run test`).

## Candidate generation

Every batch unions, dedupes (provenance merges) and ranks:

- `semantic` — per-cluster vector search, slots capped per interest so one
  dominant taste cannot eat the batch.
- `adjacent` — vector ranks just below the nearest slice: near enough to be
  plausible, far enough to surprise. (Approximation of the [0.35, 0.75]
  cosine band; the band itself is measured in eval.)
- `topic` — learned affinity or explicitly followed topics.
- `fresh` — recently pushed, quality floor via ingestion star bands.
- `long-tail` — under 500 stars; small projects stay reachable.
- `exploration` — highest unexploredness from the full unseen set, never
  from the scored pool. Protected through the pool cut.

Scores decompose as

```text
score = predicted_interest (affinity + explicit topics)
      + semantic_relevance (best + weighted − negative)
      + freshness + quality + calibrated_exploration + first-sighting
      − repetition_penalties (rerank stage)
```

No randomness anywhere: ties break by ascending repoId, exploration is
slot-separated and deterministic.

## User model

- Additive affinity (ratings/saves/opens) is maintained incrementally in
  `userRecProfiles` and mirrored exactly by `buildSignals` (parity-tested).
- Dislike minima are derived from history at generation time — minima are
  not incrementally maintainable, so they are deliberately not stored.
- Semantic interests are 3–6 emergent clusters over positive-evidence
  embeddings (never one averaged vector, never hardcoded topics).
- Dwell is recorded for analysis but excluded from affinity: time-on-card
  is too weak to move taste without validation.

## Weights

Centralized in `constants.ts` (`DEFAULT_WEIGHTS`, provisional
`SEMANTIC_WEIGHTS`). Current values reproduce the original metadata
behaviour plus: explicit-topic 0.8, semantic best 1.5 / weighted 0.5 /
negative −1.0 (inert until embeddings exist). Change one weight at a time
and re-run `npm run eval` first.

## Evaluation (`npm run eval`)

- Metric unit tests (P@K/R@K/NDCG, edge cases, no-NaN guarantees).
- Time-split replay on a deterministic synthetic universe with gates:
  NDCG@10 ≥ 0.7, P@5 ≥ 0.6, recall 1.0, owner/language spread, long-tail
  presence, semantic-vs-metadata comparison printed.
- Real-data replay: export `interactionEvents` joined with repos and
  embeddings as JSON, feed through `parseInteractionJson`, run `replay`
  per user. Production weight changes require winning on real data —
  synthetic gates prove mechanics, not taste.

Known observation from building the harness: in pure-score order,
bandit exploration for unseen facets can outrank genuine same-interest
relevance. Production is insulated by slot-separated exploration
(exploration competes for its own slots, not on raw score), but any
future unified-score redesign must re-check this tradeoff in eval first.

## Tuning procedure

1. Export recent interaction history as JSON.
2. Propose one weight change (or a small grid) with a hypothesis.
3. Run `replay` per user for baseline vs candidate; compare NDCG@10,
   recall, slate diversity (owners/languages/topics), exploration and
   long-tail shares.
4. Ship only on consistent wins with no diversity regression; record the
   numbers in the PR description.

## Cold start / GitHub-star import (deferred by design)

The intended onboarding — connect GitHub → import stars → embed/starred
repos → initial clusters → personalised feed — fits the current seams
without new architecture:

1. OAuth via Convex Auth GitHub provider; store the token server-side.
2. An ingestion action pages `/users/starred`, maps to `DiscoveredRepo`,
   reuses `saveDiscoveredRepos`.
3. Starred repos embed through `embedRepo`/backfill; clusters build from
   `clusteringData` with star evidence weighted like a 4-star rating.
4. First queue generation then behaves like any other generation.

Deferred because auth-provider setup destabilises the current app for
little gain while the catalog path is unproven — not because the model
cannot absorb it.

## Backlog (highest leverage first)

1. Real-data replay + first evidence-backed weight tuning (harness ready).
2. Denormalised card snapshots in queue rows if peek joins bite at scale;
   cursor-sharded generation beyond the 20k scan cap.
3. Embed-on-ingest hook after README enrichment (fresh repos embed faster).
4. `stats`/catalog page bounding (user-triggered, currently full scans).
5. "More/Less like this" once semantics prove out (kept distinct from
   1–5/hide by design).
