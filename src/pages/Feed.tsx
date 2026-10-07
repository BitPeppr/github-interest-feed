import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/app-header";
import { ReelCard } from "@/components/feed/reel-card";
import { Loading } from "@/components/feed/loading";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/format";

const FETCH_COOLDOWN_MS = 8_000;
const DISCOVERY_LIMIT = 24;
const KEEP_PREVIOUS = 4;
const PRUNE_AFTER = 8;

export default function Feed() {
  const [ids, setIds] = useState<number[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [baseIndex, setBaseIndex] = useState(0);
  const [previousIds, setPreviousIds] = useState<number[]>([]);
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set());
  const [savedOverrides, setSavedOverrides] = useState<Map<number, boolean>>(() => new Map());
  const [isFetching, setIsFetching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const fetching = useRef(false);
  const lastFetch = useRef(0);
  const seen = useRef(new Set<number>());
  const queued = useRef(new Set<number>());
  const touchStart = useRef<number | null>(null);
  const lastWheel = useRef(0);

  const shouldDiscover = ids.length === 0 || activeIndex >= ids.length - 5;
  const discovery = useQuery(
    api.feed.discovery,
    shouldDiscover
      ? { excludeRepoIds: [...ids, ...excluded], limit: DISCOVERY_LIMIT }
      : "skip",
  );
  const repoId = ids[activeIndex];
  const projects = useQuery(
    api.feed.projects,
    repoId === undefined ? "skip" : { repoIds: [repoId] },
  );
  const project = projects?.items.find((item) => item.repoId === repoId);

  const markSeen = useMutation(api.feed.markSeen);
  const setRating = useMutation(api.feed.setRating);
  const clearRating = useMutation(api.feed.clearRating);
  const setSaved = useMutation(api.feed.setSaved);
  const setHidden = useMutation(api.feed.setHidden);
  const fetchMore = useAction(api.github.fetchMore);

  useEffect(() => {
    if (!shouldDiscover || !discovery) return;
    const additions = discovery.repoIds.filter(
      (id) => !queued.current.has(id) && !excluded.has(id),
    );
    if (!additions.length) return;
    additions.forEach((id) => queued.current.add(id));
    const timer = window.setTimeout(() => {
      setIds((current) => [...current, ...additions.filter((id) => !current.includes(id))]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [discovery, excluded, shouldDiscover]);

  const loadMore = useCallback(async (force = false) => {
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
  }, [fetchMore]);

  const next = useCallback(() => {
    if (activeIndex >= ids.length - 1) return;
    const newIndex = activeIndex + 1;
    setActiveIndex(newIndex);
    if (newIndex >= PRUNE_AFTER) {
      const removed = ids.slice(0, KEEP_PREVIOUS);
      setPreviousIds((previous) => [...previous.slice(-KEEP_PREVIOUS), ...removed]);
      setIds((current) => current.slice(KEEP_PREVIOUS));
      setActiveIndex(newIndex - KEEP_PREVIOUS);
      setBaseIndex((current) => current + KEEP_PREVIOUS);
    }
  }, [activeIndex, ids]);

  const previous = useCallback(() => {
    if (activeIndex > 0) {
      setActiveIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (previousIds.length === 0) return;
    const restore = previousIds.slice(-KEEP_PREVIOUS);
    setPreviousIds((current) => current.slice(0, -restore.length));
    setIds((current) => [...restore, ...current]);
    setBaseIndex((current) => Math.max(0, current - restore.length));
    setActiveIndex(restore.length - 1);
  }, [activeIndex, previousIds]);

  useEffect(() => {
    if (repoId === undefined || seen.current.has(repoId)) return;
    seen.current.add(repoId);
    void markSeen({ repoIds: [repoId] }).catch(() => {});
  }, [markSeen, repoId]);

  useEffect(() => {
    if (!shouldDiscover || !discovery || discovery.repoIds.length > 0 || isFetching || problem) return;
    const timer = window.setTimeout(() => void loadMore(), 0);
    return () => window.clearTimeout(timer);
  }, [discovery, isFetching, loadMore, problem, shouldDiscover]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault();
        next();
      }
      if (event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        previous();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, previous]);

  const rate = useCallback((id: number, value: number) => {
    void setRating({ repoId: id, value }).catch((error) => toast.error(errorText(error)));
  }, [setRating]);
  const clear = useCallback((id: number) => {
    void clearRating({ repoId: id }).catch((error) => toast.error(errorText(error)));
  }, [clearRating]);
  const toggleSaved = useCallback((id: number, saved: boolean) => {
    setSavedOverrides((current) => new Map(current).set(id, saved));
    void setSaved({ repoId: id, saved }).catch((error) => {
      setSavedOverrides((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      toast.error(errorText(error));
    });
  }, [setSaved]);
  const skip = useCallback((id: number) => {
    setExcluded((current) => new Set(current).add(id));
    setIds((current) => current.filter((currentId) => currentId !== id));
    void setHidden({ repoId: id, hidden: true })
      .then(() => setExcluded((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      }))
      .catch((error) => toast.error(errorText(error)));
  }, [setHidden]);

  const error = problem ? (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs">
      <span className="text-muted-foreground">{problem}</span>
      <Button variant="outline" size="sm" onClick={() => void loadMore(true)}>
        <RefreshCw className="mr-2 size-3.5" />Retry
      </Button>
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader active="feed" />
      <main
        className="mx-auto flex min-h-[calc(100svh-56px)] w-full max-w-4xl flex-col px-4 py-5 sm:px-6"
        onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientY ?? null; }}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          const end = event.changedTouches[0]?.clientY;
          if (start === null || end === undefined) return;
          if (event.target instanceof Element && event.target.closest("[data-radix-dialog-content]")) return;
          const delta = start - end;
          if (delta > 65) next();
          if (delta < -65) previous();
        }}
        onWheel={(event) => {
          if (event.target instanceof Element && event.target.closest("[data-radix-dialog-content]")) return;
          if (Math.abs(event.deltaY) < 40) return;
          const now = Date.now();
          if (now - lastWheel.current < 650) return;
          lastWheel.current = now;
          if (event.deltaY > 0) next();
          else previous();
        }}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Explore</h1>
            <p className="text-xs text-muted-foreground">One project at a time</p>
          </div>
          <p className="text-xs tabular-nums text-muted-foreground">
            {baseIndex + activeIndex + 1} explored · {discovery?.rated ?? 0} rated
          </p>
        </div>
        {error}

        <div className="flex flex-1 flex-col justify-center">
          {ids.length === 0 && discovery === undefined ? (
            <Loading label="Finding your next project…" />
          ) : repoId === undefined ? (
            <div className="flex min-h-[55vh] flex-col items-center justify-center gap-3 text-center">
              {isFetching && <Spinner className="size-5" />}
              <p className="text-sm text-muted-foreground">
                {isFetching ? "Finding projects for you…" : "No projects ready yet."}
              </p>
              {!isFetching && <Button onClick={() => void loadMore(true)}>Find projects</Button>}
            </div>
          ) : !project ? (
            <Loading label="Loading project…" />
          ) : (
            <div className="mx-auto flex min-h-[65vh] w-full max-w-3xl items-center">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={repoId}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -18 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="w-full"
                >
                  <ReelCard
                    project={{ ...project, saved: savedOverrides.get(repoId) ?? project.saved }}
                    active
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

        {repoId !== undefined && (
          <div className="mx-auto mt-4 flex w-full max-w-3xl items-center justify-between border-t border-border pt-3">
            <Button variant="ghost" size="sm" disabled={activeIndex === 0 && previousIds.length === 0} onClick={previous}>↑ Previous</Button>
            <span className="text-xs text-muted-foreground">Scroll, swipe, or rate to continue</span>
            <Button variant="ghost" size="sm" onClick={next}>Next ↓</Button>
          </div>
        )}
        {isFetching && repoId !== undefined && (
          <p className="mt-2 text-center text-xs text-muted-foreground"><Spinner className="mr-2 inline size-3.5" />Finding more projects…</p>
        )}
      </main>
    </div>
  );
}
