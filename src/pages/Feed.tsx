import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/app-header";
import { Loading } from "@/components/feed/loading";
import { ProjectCard } from "@/components/feed/project-card";
import type { Project } from "@/components/feed/types";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/convex/_generated/api";
import { useRatings } from "@/hooks/use-ratings";
import { errorText } from "@/lib/format";

/** Cards kept in memory at once; far more than one sitting needs. */
const MAX_QUEUE = 150;
/** Refill discovery once fewer than this many unseen projects remain. */
const LOW_POOL = 12;
/** Wait before asking GitHub again after a failed attempt. */
const REFILL_COOLDOWN_MS = 15_000;
const README_BATCH = 6;

export default function Feed() {
  const discovery = useQuery(api.feed.discovery);
  const [ids, setIds] = useState<number[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const queued = useRef(new Set<number>());
  const seen = useRef(new Set<number>());
  const pendingSeen = useRef(new Set<number>());
  const seenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodes = useRef(new Map<number, HTMLElement>());
  const sentinel = useRef<HTMLDivElement | null>(null);
  const fetching = useRef(false);
  const lastAttempt = useRef(0);
  const enriching = useRef(new Set<number>());
  const enrichQueue = useRef<number[]>([]);
  const enrichTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const projects = useQuery(
    api.feed.projects,
    ids.length > 0 ? { repoIds: ids } : "skip",
  );
  const markSeen = useMutation(api.feed.markSeen);
  const setSaved = useMutation(api.feed.setSaved);
  const setHidden = useMutation(api.feed.setHidden);
  const fetchMore = useAction(api.github.fetchMore);
  const enrich = useAction(api.github.enrich);
  const { rate, clear } = useRatings();

  /* --- hold the window of projects in a local, append-only queue ------- */

  useEffect(() => {
    if (!discovery) return;
    const fresh = discovery.repoIds.filter(
      (id) => !queued.current.has(id) && !dismissed.has(id),
    );
    if (fresh.length === 0) return;
    setIds((previous) => {
      const room = MAX_QUEUE - previous.length;
      if (room <= 0) return previous;
      const added = fresh.slice(0, room);
      added.forEach((id) => queued.current.add(id));
      return [...previous, ...added];
    });
  }, [discovery, dismissed]);

  /* --- reading READMEs, on demand, as cards come into view ------------- */

  const queueEnrich = useCallback(
    (repoId: number) => {
      if (enriching.current.has(repoId)) return;
      enriching.current.add(repoId);
      enrichQueue.current.push(repoId);

      const flush = () => {
        enrichTimer.current = null;
        const batch = enrichQueue.current.splice(0, README_BATCH);
        if (batch.length > 0) {
          void enrich({ repoIds: batch }).catch(() => {
            // A README that will not load is not worth interrupting the feed.
          });
        }
        if (enrichQueue.current.length > 0) {
          enrichTimer.current = setTimeout(flush, 250);
        }
      };

      if (!enrichTimer.current) enrichTimer.current = setTimeout(flush, 350);
    },
    [enrich],
  );

  /* --- tell the backend which projects have scrolled past -------------- */

  const handleSeen = useCallback(
    (repoId: number) => {
      if (seen.current.has(repoId)) return;
      seen.current.add(repoId);
      pendingSeen.current.add(repoId);
      queueEnrich(repoId);

      if (seenTimer.current) return;
      seenTimer.current = setTimeout(() => {
        seenTimer.current = null;
        const batch = [...pendingSeen.current];
        pendingSeen.current.clear();
        if (batch.length === 0) return;
        void markSeen({ repoIds: batch }).catch(() => {
          // Seen markers are best effort; the feed refills anyway.
        });
      }, 400);
    },
    [markSeen, queueEnrich],
  );

  useEffect(
    () => () => {
      if (seenTimer.current) clearTimeout(seenTimer.current);
      if (enrichTimer.current) clearTimeout(enrichTimer.current);
    },
    [],
  );

  /* --- keep the feed full --------------------------------------------- */

  const loadMore = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    setIsLoadingMore(true);
    lastAttempt.current = Date.now();
    try {
      const result = await fetchMore({ count: 2 });
      setProblem(result.errors.length > 0 ? result.errors[0].message : null);
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      fetching.current = false;
      setIsLoadingMore(false);
    }
  }, [fetchMore]);

  useEffect(() => {
    if (!discovery || ids.length >= MAX_QUEUE) return;
    if (discovery.remaining >= LOW_POOL) return;
    if (fetching.current) return;
    if (Date.now() - lastAttempt.current < REFILL_COOLDOWN_MS) return;
    void loadMore();
  }, [discovery, ids.length, loadMore]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "500px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  /* --- interactions ---------------------------------------------------- */

  const handleToggleSaved = useCallback(
    (repoId: number, saved: boolean) => {
      void setSaved({ repoId, saved }).catch((error) =>
        toast.error(errorText(error)),
      );
    },
    [setSaved],
  );

  const handleHide = useCallback(
    (repoId: number) => {
      setDismissed((previous) => new Set(previous).add(repoId));
      void setHidden({ repoId, hidden: true }).catch((error) =>
        toast.error(errorText(error)),
      );
      toast("Hidden — it will not come back to your feed.", {
        action: {
          label: "Undo",
          onClick: () => {
            setDismissed((previous) => {
              const next = new Set(previous);
              next.delete(repoId);
              return next;
            });
            void setHidden({ repoId, hidden: false }).catch(() => {
              // If undo fails the project simply stays hidden.
            });
          },
        },
      });
    },
    [setHidden],
  );

  const cards = useMemo(() => {
    const byId = new Map(
      (projects?.items ?? []).map((item) => [item.repoId, item]),
    );
    return ids
      .filter((id) => !dismissed.has(id))
      .map((id) => byId.get(id))
      .filter((item): item is Project => item !== undefined);
  }, [projects, ids, dismissed]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const targetId = ids[index];
      const node = targetId ? nodes.current.get(targetId) : undefined;
      if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
      else void loadMore();
    },
    [ids, loadMore],
  );

  const registerNode = useCallback((repoId: number, node: HTMLElement | null) => {
    if (node) nodes.current.set(repoId, node);
    else nodes.current.delete(repoId);
  }, []);

  const ratedCount = discovery?.rated ?? 0;
  const catalogSize = discovery?.catalogSize ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader active="feed" />

      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="mx-auto w-full max-w-2xl px-6 py-8 lg:py-10"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              Your feed
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Projects picked for you from across GitHub. Rate what interests
              you, save what you want to keep.
            </p>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {ratedCount} rated · {catalogSize} in your catalog
          </p>
        </div>

        {problem && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {problem}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                lastAttempt.current = 0;
                void loadMore();
              }}
            >
              <RefreshCw className="size-3.5" />
              Try again
            </Button>
          </div>
        )}

        {discovery === undefined || (ids.length > 0 && projects === undefined) ? (
          <Loading label="Opening your feed…" />
        ) : cards.length === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-xl border border-border px-6 py-16 text-center">
            <Spinner className="size-4 text-muted-foreground" />
            <p className="text-sm font-medium">
              {isLoadingMore
                ? "Looking for something you have not seen yet…"
                : "Nothing new right now"}
            </p>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              {isLoadingMore
                ? "GitHub is handing over the next batch."
                : "Fetch the next batch of projects, or follow a topic on your dashboard to steer what turns up."}
            </p>
            {!isLoadingMore && (
              <Button
                className="mt-2"
                onClick={() => {
                  lastAttempt.current = 0;
                  void loadMore();
                }}
              >
                Fetch more projects
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-8 space-y-6">
            {cards.map((project, index) => (
              <div
                key={project.repoId}
                ref={(node) => registerNode(project.repoId, node)}
              >
                <ProjectCard
                  project={project}
                  onRate={rate}
                  onClear={clear}
                  onToggleSaved={handleToggleSaved}
                  onHide={handleHide}
                  onNext={() => scrollToIndex(index + 1)}
                  onSeen={handleSeen}
                />
              </div>
            ))}
          </div>
        )}

        <div ref={sentinel} className="h-px" />

        {cards.length > 0 && isLoadingMore && (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            Fetching more projects…
          </div>
        )}
      </motion.main>
    </div>
  );
}
