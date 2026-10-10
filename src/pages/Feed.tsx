import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/app-header";
import { StarsImport } from "@/components/stars-import";
import { ReelCard } from "@/components/feed/reel-card";
import { Loading } from "@/components/feed/loading";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/format";

/**
 * The README dialog lives in a portal, but React still bubbles its wheel and
 * touch events up this tree, so the feed has to ignore them explicitly while
 * it is mounted. Scrolling the README must never change the project.
 */
function readmeOverlayOpen() {
  return document.querySelector("[data-readme-overlay]") !== null;
}

/**
 * Cards are taller than the viewport, so the page scrolls inside a card. The
 * wheel/touch handlers only flip to the next project at the scroll edges;
 * anywhere in between, scrolling is just scrolling.
 */
const EDGE_SLACK = 32;

function atScrollTop() {
  return window.scrollY <= EDGE_SLACK;
}

function atScrollBottom() {
  return (
    window.innerHeight + window.scrollY >=
    document.documentElement.scrollHeight - EDGE_SLACK
  );
}

/** How many upcoming cards keep their README subscription and image warm. */
const PREFETCH_AHEAD = 6;
/** Background enrichment batches, matching the action's per-call cap. */
const WARM_BATCH = 6;
/** Warm batches run a few at a time so a backlog fills in seconds, not minutes. */
const WARM_CONCURRENCY = 3;
/** Give a failed warm batch a couple of retries before giving up on it. */
const WARM_RETRIES = 2;
const WARM_RETRY_DELAY_MS = 4_000;
/**
 * A warm entry lives as long as a card might still arrive at it. After that it
 * expires: the queue serves the cards in front of the viewer, not repos they
 * have already scrolled past, and a README that keeps failing falls out on
 * its own instead of retrying forever.
 */
const WARM_TTL_MS = 60_000;

const FETCH_COOLDOWN_MS = 8_000;
const DISCOVERY_LIMIT = 24;
const KEEP_PREVIOUS = 4;
const PRUNE_AFTER = 8;
/** Only report dwell that clears this bar — short scrolls are not interest. */
const DWELL_REPORT_MS = 3_000;

/**
 * Keeps the README subscription and hero image of the next few cards warm, so
 * arriving at one shows the finished card instead of one reorganizing itself.
 * The fetching itself runs in the background warm queue above.
 */
function PrefetchRepo({ repoId }: { repoId: number }) {
  const readme = useQuery(api.feed.readme, { repoId });

  const image = readme?.images?.[0];
  useEffect(() => {
    if (!image) return;
    // Decode the screenshot into the browser cache before the card renders.
    const warm = new Image();
    warm.src = image;
  }, [image]);

  return null;
}

export default function Feed() {
  const [ids, setIds] = useState<number[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [baseIndex, setBaseIndex] = useState(0);
  const [previousIds, setPreviousIds] = useState<number[]>([]);
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set());
  const [savedOverrides, setSavedOverrides] = useState<Map<number, boolean>>(
    () => new Map(),
  );
  const [isFetching, setIsFetching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [direction, setDirection] = useState(1);

  const fetching = useRef(false);
  const lastFetch = useRef(0);
  const seen = useRef(new Set<number>());
  const queued = useRef(new Set<number>());
  const touchStart = useRef<number | null>(null);
  const lastWheel = useRef(0);
  const warmQueue = useRef<{ id: number; expiresAt: number }[]>([]);
  const warmBatchesInFlight = useRef(0);
  const warmAttempts = useRef(new Map<number, number>());

  const shouldDiscover = ids.length === 0 || activeIndex >= ids.length - 5;
  const discovery = useQuery(
    api.feed.discovery,
    shouldDiscover
      ? { excludeRepoIds: [...ids, ...excluded], limit: DISCOVERY_LIMIT }
      : "skip",
  );
  const repoId = ids[activeIndex];
  // Metadata for the next few cards is fetched up front too, so advancing
  // never lands on a "Loading project…" placeholder.
  const upcomingIds = ids.slice(
    activeIndex + 1,
    activeIndex + 1 + PREFETCH_AHEAD,
  );
  const projects = useQuery(
    api.feed.projects,
    repoId === undefined ? "skip" : { repoIds: [repoId, ...upcomingIds] },
  );
  const project = projects?.items.find((item) => item.repoId === repoId);
  // Shares the prefetch buffer's subscription, so on every card change this
  // resolves synchronously instead of starting a fresh query round-trip.
  const readmeData = useQuery(
    api.feed.readme,
    repoId === undefined ? "skip" : { repoId },
  );

  const markSeen = useMutation(api.feed.markSeen);
  const setRating = useMutation(api.feed.setRating);
  const clearRating = useMutation(api.feed.clearRating);
  const setSaved = useMutation(api.feed.setSaved);
  const setHidden = useMutation(api.feed.setHidden);
  const trackEvent = useMutation(api.feed.trackEvent);
  const fetchMore = useAction(api.github.fetchMore);
  const enrich = useAction(api.github.enrich);

  /**
   * Drains the warm queue: background README enrichment for whole discovery
   * batches, running the moment projects enter the feed — never waiting for
   * the viewer to scroll near them. Failed batches retry a bounded number of
   * times and only while their entries are still fresh.
   */
  const drainWarmQueue = useCallback(
    function drain() {
      // Expired entries are dropped first: the queue only serves cards that are
      // still in front of the viewer.
      const now = Date.now();
      warmQueue.current = warmQueue.current.filter(
        (entry) => entry.expiresAt > now,
      );
      while (
        warmBatchesInFlight.current < WARM_CONCURRENCY &&
        warmQueue.current.length > 0
      ) {
        const batch = warmQueue.current.splice(0, WARM_BATCH);
        warmBatchesInFlight.current += 1;
        void (async () => {
          try {
            await enrich({ repoIds: batch.map((entry) => entry.id) });
          } catch {
            const retry = batch.filter((entry) => {
              const attempts = (warmAttempts.current.get(entry.id) ?? 0) + 1;
              warmAttempts.current.set(entry.id, attempts);
              return attempts <= WARM_RETRIES && entry.expiresAt > Date.now();
            });
            // Schedule the retry without holding a concurrency slot while it
            // waits, so the backlog keeps draining during the delay.
            if (retry.length > 0) {
              window.setTimeout(() => {
                warmQueue.current.push(...retry);
                drain();
              }, WARM_RETRY_DELAY_MS);
            }
          } finally {
            warmBatchesInFlight.current -= 1;
            if (warmQueue.current.length > 0) drain();
          }
        })();
      }
    },
    [enrich],
  );

  useEffect(() => {
    if (!shouldDiscover || !discovery) return;
    const additions = discovery.repoIds.filter(
      (id) => !queued.current.has(id) && !excluded.has(id),
    );
    if (!additions.length) return;
    additions.forEach((id) => queued.current.add(id));
    // Warm the whole batch in the background right now, so cards are ready
    // long before the viewer reaches them.
    const expiresAt = Date.now() + WARM_TTL_MS;
    warmQueue.current.push(...additions.map((id) => ({ id, expiresAt })));
    drainWarmQueue();
    // Append synchronously: a deferred append could be cancelled by a dep
    // change after `queued` was marked, losing these ids for good.
    setIds((current) => [
      ...current,
      ...additions.filter((id) => !current.includes(id)),
    ]);
  }, [discovery, drainWarmQueue, excluded, shouldDiscover]);

  const loadMore = useCallback(
    async (force = false) => {
      if (fetching.current) return;
      if (!force && Date.now() - lastFetch.current < FETCH_COOLDOWN_MS) return;
      fetching.current = true;
      lastFetch.current = Date.now();
      setIsFetching(true);
      setProblem(null);
      try {
        const result = await fetchMore({ count: 2 });
        if (result.errors.length) setProblem(result.errors[0].message);
      } catch (error) {
        setProblem(errorText(error));
      } finally {
        fetching.current = false;
        setIsFetching(false);
      }
    },
    [fetchMore],
  );

  const next = useCallback(() => {
    if (activeIndex >= ids.length - 1) return;
    setDirection(1);
    const newIndex = activeIndex + 1;
    setActiveIndex(newIndex);
    if (newIndex >= PRUNE_AFTER) {
      const removed = ids.slice(0, KEEP_PREVIOUS);
      setPreviousIds((previous) => [
        ...previous.slice(-KEEP_PREVIOUS),
        ...removed,
      ]);
      setIds((current) => current.slice(KEEP_PREVIOUS));
      setActiveIndex(newIndex - KEEP_PREVIOUS);
      setBaseIndex((current) => current + KEEP_PREVIOUS);
    }
    // Every card starts from its top, however tall the last one was.
    window.scrollTo(0, 0);
  }, [activeIndex, ids]);

  const previous = useCallback(() => {
    if (activeIndex === 0 && previousIds.length === 0) return;
    setDirection(-1);
    if (activeIndex > 0) {
      setActiveIndex((index) => Math.max(0, index - 1));
      window.scrollTo(0, 0);
      return;
    }
    const restore = previousIds.slice(-KEEP_PREVIOUS);
    setPreviousIds((current) => current.slice(0, -restore.length));
    setIds((current) => [...restore, ...current]);
    setBaseIndex((current) => Math.max(0, current - restore.length));
    setActiveIndex(restore.length - 1);
    window.scrollTo(0, 0);
  }, [activeIndex, previousIds]);

  useEffect(() => {
    if (repoId === undefined || seen.current.has(repoId)) return;
    seen.current.add(repoId);
    void markSeen({ repoIds: [repoId] }).catch(() => {});
  }, [markSeen, repoId]);

  // Aggregate dwell per card: start the clock when a card becomes active,
  // report once when leaving it (or unmounting). Hidden-tab time never
  // counts — the clock restarts when the tab becomes visible again.
  const dwellStart = useRef<{ repoId: number; start: number } | null>(null);
  useEffect(() => {
    if (repoId === undefined) return;
    dwellStart.current = { repoId, start: Date.now() };
    return () => {
      const current = dwellStart.current;
      if (
        current &&
        current.repoId === repoId &&
        document.visibilityState === "visible"
      ) {
        const ms = Date.now() - current.start;
        if (ms >= DWELL_REPORT_MS) {
          void trackEvent({ repoId, kind: "dwell", value: ms }).catch(() => {});
        }
      }
    };
  }, [repoId, trackEvent]);

  useEffect(() => {
    function onVisibility() {
      // Discard whatever accumulated while hidden; restart the clock.
      if (repoId !== undefined) {
        dwellStart.current = { repoId, start: Date.now() };
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [repoId]);

  useEffect(() => {
    if (
      !shouldDiscover ||
      !discovery ||
      discovery.repoIds.length > 0 ||
      isFetching ||
      problem
    )
      return;
    const timer = window.setTimeout(() => void loadMore(), 0);
    return () => window.clearTimeout(timer);
  }, [discovery, isFetching, loadMore, problem, shouldDiscover]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // The README dialog owns the keyboard while it is open.
      if (readmeOverlayOpen()) return;
      if (event.key === "ArrowDown" || event.key === "PageDown") {
        // Mid-card the arrows scroll the page like always; at the bottom they
        // flip to the next project.
        if (!atScrollBottom()) return;
        event.preventDefault();
        next();
      }
      if (event.key === "ArrowUp" || event.key === "PageUp") {
        if (!atScrollTop()) return;
        event.preventDefault();
        previous();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, previous]);

  /** Optimistic cards roll back when these resolve false. */
  const rate = useCallback(
    (id: number, value: number): Promise<boolean> => {
      return setRating({ repoId: id, value })
        .then(() => true)
        .catch((error) => {
          toast.error(errorText(error));
          return false;
        });
    },
    [setRating],
  );
  const clear = useCallback(
    (id: number): Promise<boolean> => {
      return clearRating({ repoId: id })
        .then(() => true)
        .catch((error) => {
          toast.error(errorText(error));
          return false;
        });
    },
    [clearRating],
  );
  const toggleSaved = useCallback(
    (id: number, saved: boolean) => {
      setSavedOverrides((current) => new Map(current).set(id, saved));
      void setSaved({ repoId: id, saved }).catch((error) => {
        setSavedOverrides((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
        toast.error(errorText(error));
      });
    },
    [setSaved],
  );
  const skip = useCallback(
    (id: number) => {
      setExcluded((current) => new Set(current).add(id));
      setIds((current) => current.filter((currentId) => currentId !== id));
      void setHidden({ repoId: id, hidden: true })
        .then(() =>
          setExcluded((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          }),
        )
        .catch((error) => toast.error(errorText(error)));
    },
    [setHidden],
  );

  const error = problem ? (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs">
      <span className="text-muted-foreground">{problem}</span>
      <Button variant="outline" size="sm" onClick={() => void loadMore(true)}>
        <RefreshCw className="mr-2 size-3.5" />
        Retry
      </Button>
    </div>
  ) : null;

  return (
    <div className="relative min-h-screen text-foreground">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-x-0 -top-48 h-[40rem] bg-[radial-gradient(40rem_28rem_at_50%_45%,var(--accent),transparent_72%)]" />
        <div className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(to_right,var(--foreground)_1px,transparent_1px),linear-gradient(to_bottom,var(--foreground)_1px,transparent_1px)] [background-size:64px_64px]" />
      </div>
      <AppHeader active="feed" />
      <main
        className="mx-auto flex min-h-[calc(100svh-56px)] w-full max-w-4xl flex-col px-4 py-5 sm:px-6"
        onTouchStart={(event) => {
          touchStart.current = event.touches[0]?.clientY ?? null;
        }}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          const end = event.changedTouches[0]?.clientY;
          if (start === null || end === undefined) return;
          if (readmeOverlayOpen()) return;
          const delta = start - end;
          // Only a swipe from the very bottom of a card advances it.
          if (delta > 65 && atScrollBottom()) next();
          if (delta < -65 && atScrollTop()) previous();
        }}
        onWheel={(event) => {
          if (readmeOverlayOpen()) return;
          if (Math.abs(event.deltaY) < 40) return;
          const scrollingDown = event.deltaY > 0;
          if (scrollingDown ? !atScrollBottom() : !atScrollTop()) return;
          const now = Date.now();
          if (now - lastWheel.current < 650) return;
          lastWheel.current = now;
          if (scrollingDown) next();
          else previous();
        }}
      >
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Explore</h1>
            <p className="mt-0.5 font-mono text-[11px] tracking-[0.22em] text-muted-foreground uppercase">
              One project at a time
            </p>
          </div>
          <p className="text-xs tabular-nums text-muted-foreground">
            <span className="text-foreground">
              {baseIndex + activeIndex + 1}
            </span>{" "}
            explored · {discovery?.rated ?? 0} rated
          </p>
        </div>
        {/* The buffer holds a subscription for the current card too, so the
            handoff at each card change keeps its README result warm. */}
        {[...(repoId === undefined ? [] : [repoId]), ...upcomingIds].map(
          (id) => (
            <PrefetchRepo key={id} repoId={id} />
          ),
        )}
        {(discovery?.rated ?? 0) < 8 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Bring your taste with you</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Import your GitHub stars and the feed is personalized before you
                rate anything.
              </p>
            </div>
            <StarsImport />
          </div>
        )}
        {error}

        <div className="flex flex-1 flex-col justify-center">
          {ids.length === 0 && discovery === undefined ? (
            <Loading label="Finding your next project…" />
          ) : repoId === undefined ? (
            <div className="flex min-h-[55vh] flex-col items-center justify-center gap-3 text-center">
              {isFetching && <Spinner className="size-5" />}
              <p className="text-sm text-muted-foreground">
                {isFetching
                  ? "Finding projects for you…"
                  : "No projects ready yet."}
              </p>
              {!isFetching && (
                <Button onClick={() => void loadMore(true)}>
                  Find projects
                </Button>
              )}
            </div>
          ) : !project || readmeData === undefined ? (
            // Never render a half-built card: wait for the README payload so
            // the card appears with its image and text already in place.
            <Loading label="Loading project…" />
          ) : (
            <div className="mx-auto flex min-h-[65vh] w-full max-w-3xl items-center">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={repoId}
                  initial={{ opacity: 0, y: direction * 22, scale: 0.99 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: direction * -22, scale: 0.99 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="w-full"
                >
                  <ReelCard
                    project={{
                      ...project,
                      saved: savedOverrides.get(repoId) ?? project.saved,
                    }}
                    active
                    index={baseIndex + activeIndex + 1}
                    onRate={rate}
                    onClear={clear}
                    onToggleSaved={toggleSaved}
                    onSkip={skip}
                    onPrevious={previous}
                    onNext={next}
                    onRated={next}
                  />
                </motion.div>
              </AnimatePresence>
            </div>
          )}
        </div>

        {isFetching && repoId !== undefined && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            <Spinner className="mr-2 inline size-3.5" />
            Finding more projects…
          </p>
        )}
      </main>
    </div>
  );
}
