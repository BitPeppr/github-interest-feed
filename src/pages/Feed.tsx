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
import { errorText } from "@/lib/format";

const MAX_QUEUE = 24;
const LOW_POOL = 12;
const REFILL_COOLDOWN_MS = 20_000;
const SEEN_BATCH = 8;
const SEEN_INTERVAL_MS = 1200;

export default function Feed() {
  const discovery = useQuery(api.feed.discovery);
  const [ids, setIds] = useState<number[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(() => new Set());
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pendingRatings, setPendingRatings] = useState<Map<number, number | null>>(
    () => new Map(),
  );
  const [pendingSaved, setPendingSaved] = useState<Map<number, boolean>>(
    () => new Map(),
  );

  const idsRef = useRef<number[]>([]);
  const queued = useRef(new Set<number>());
  const seen = useRef(new Set<number>());
  const passed = useRef(new Set<number>());
  const pendingSeen = useRef(new Set<number>());
  const seenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodes = useRef(new Map<number, HTMLElement>());
  const sentinel = useRef<HTMLDivElement | null>(null);
  const fetching = useRef(false);
  const lastAttempt = useRef(0);

  useEffect(() => {
    idsRef.current = ids;
  }, [ids]);

  const projects = useQuery(
    api.feed.projects,
    ids.length > 0 ? { repoIds: ids } : "skip",
  );
  const markSeen = useMutation(api.feed.markSeen);
  const setSaved = useMutation(api.feed.setSaved);
  const setHidden = useMutation(api.feed.setHidden);
  const setRating = useMutation(api.feed.setRating);
  const clearRating = useMutation(api.feed.clearRating);
  const fetchMore = useAction(api.github.fetchMore);

  useEffect(() => {
    if (!discovery) return;
    const fresh = discovery.repoIds.filter(
      (id) => !queued.current.has(id) && !dismissed.has(id),
    );
    if (fresh.length === 0) return;
    setIds((previous) => {
      const added = fresh.slice(0, Math.max(0, MAX_QUEUE - previous.length));
      added.forEach((id) => queued.current.add(id));
      return added.length ? [...previous, ...added] : previous;
    });
  }, [discovery, dismissed]);

  const flushSeen = useCallback(() => {
    seenTimer.current = null;
    const batch = [...pendingSeen.current];
    pendingSeen.current.clear();
    if (batch.length > 0) void markSeen({ repoIds: batch }).catch(() => {});
  }, [markSeen]);

  const handleSeen = useCallback(
    (repoId: number) => {
      if (seen.current.has(repoId)) return;
      seen.current.add(repoId);
      pendingSeen.current.add(repoId);
      if (pendingSeen.current.size >= SEEN_BATCH) flushSeen();
      else if (!seenTimer.current) {
        seenTimer.current = setTimeout(flushSeen, SEEN_INTERVAL_MS);
      }
    },
    [flushSeen],
  );

  useEffect(
    () => () => {
      if (seenTimer.current) clearTimeout(seenTimer.current);
      const batch = [...pendingSeen.current];
      pendingSeen.current.clear();
      if (batch.length > 0) void markSeen({ repoIds: batch }).catch(() => {});
    },
    [markSeen],
  );

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
    if (discovery.remaining >= LOW_POOL || fetching.current) return;
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
      { rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  const handleRate = useCallback(
    (repoId: number, value: number) => {
      setPendingRatings((current) => new Map(current).set(repoId, value));
      void setRating({ repoId, value }).catch((error) => {
        setPendingRatings((current) => {
          const next = new Map(current);
          next.delete(repoId);
          return next;
        });
        toast.error(errorText(error));
      });
    },
    [setRating],
  );
  const handleClear = useCallback(
    (repoId: number) => {
      setPendingRatings((current) => new Map(current).set(repoId, null));
      void clearRating({ repoId }).catch((error) => {
        setPendingRatings((current) => {
          const next = new Map(current);
          next.delete(repoId);
          return next;
        });
        toast.error(errorText(error));
      });
    },
    [clearRating],
  );
  const handleToggleSaved = useCallback(
    (repoId: number, saved: boolean) => {
      setPendingSaved((current) => new Map(current).set(repoId, saved));
      void setSaved({ repoId, saved }).catch((error) => {
        setPendingSaved((current) => {
          const next = new Map(current);
          next.delete(repoId);
          return next;
        });
        toast.error(errorText(error));
      });
    },
    [setSaved],
  );

  const handleHide = useCallback(
    (repoId: number) => {
      setDismissed((current) => new Set(current).add(repoId));
      void setHidden({ repoId, hidden: true }).catch((error) =>
        toast.error(errorText(error)),
      );
      toast("Skipped.", {
        action: {
          label: "Undo",
          onClick: () => {
            setDismissed((current) => {
              const next = new Set(current);
              next.delete(repoId);
              return next;
            });
            void setHidden({ repoId, hidden: false }).catch(() => {});
          },
        },
      });
    },
    [setHidden],
  );

  const handlePassed = useCallback((repoId: number) => {
    if (passed.current.has(repoId)) return;
    passed.current.add(repoId);
    setIds((current) => {
      if (current.length <= LOW_POOL) return current;
      return current.filter((id) => id !== repoId);
    });
  }, []);

  const goTo = useCallback(
    (index: number) => {
      const node = nodes.current.get(idsRef.current[index]);
      if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
      else void loadMore();
    },
    [loadMore],
  );
  const registerNode = useCallback(
    (repoId: number, node: HTMLElement | null) => {
      if (node) nodes.current.set(repoId, node);
      else nodes.current.delete(repoId);
    },
    [],
  );

  const cards = useMemo(() => {
    const byId = new Map((projects?.items ?? []).map((item) => [item.repoId, item]));
    return ids
      .filter((id) => !dismissed.has(id))
      .map((id) => byId.get(id))
      .filter((item): item is Project => item !== undefined);
  }, [projects, ids, dismissed]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader active="feed" />
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 lg:py-8"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">Feed</h1>
            <p className="mt-1 text-sm text-muted-foreground">Rate projects. Save the good ones.</p>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {discovery?.rated ?? 0} rated · {discovery?.catalogSize ?? 0} projects
          </p>
        </div>

        {problem && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">{problem}</p>
            <Button variant="outline" size="sm" onClick={() => void loadMore()}>
              <RefreshCw className="mr-2 size-3.5" /> Try again
            </Button>
          </div>
        )}

        {discovery === undefined || (ids.length > 0 && projects === undefined) ? (
          <Loading label="Loading projects…" />
        ) : cards.length === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-xl border border-border px-6 py-12 text-center">
            {isLoadingMore && <Spinner className="size-4 text-muted-foreground" />}
            <p className="text-sm font-medium">{isLoadingMore ? "Finding projects…" : "No projects yet"}</p>
            {!isLoadingMore && (
              <Button onClick={() => void loadMore()}>Load projects</Button>
            )}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {cards.map((project, index) => (
              <ProjectCard
                key={project.repoId}
                project={{
                  ...project,
                  rating: pendingRatings.has(project.repoId)
                    ? pendingRatings.get(project.repoId) ?? null
                    : project.rating,
                  saved: pendingSaved.get(project.repoId) ?? project.saved,
                }}
                index={index}
                onRate={handleRate}
                onClear={handleClear}
                onToggleSaved={handleToggleSaved}
                onHide={handleHide}
                onSeen={handleSeen}
                onPassed={handlePassed}
                onGoTo={goTo}
                registerNode={registerNode}
              />
            ))}
          </div>
        )}
        <div ref={sentinel} className="h-px" />
      </motion.main>
    </div>
  );
}
