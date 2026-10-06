import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { Search, X } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { Loading } from "@/components/feed/loading";
import { RepoRow } from "@/components/feed/repo-row";
import type { Project } from "@/components/feed/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { useRatings } from "@/hooks/use-ratings";

type SortKey = "stars" | "active" | "added" | "name";

const SORTS: Record<SortKey, string> = {
  stars: "Most stars",
  active: "Recently active",
  added: "Recently added",
  name: "Name (A–Z)",
};

/** Rendering every cached project at once gets heavy; ask people to narrow down. */
const VISIBLE_LIMIT = 120;

export default function Catalog() {
  const data = useQuery(api.feed.catalog);
  const { rate, clear } = useRatings();

  const [search, setSearch] = useState("");
  const [topic, setTopic] = useState("all");
  const [language, setLanguage] = useState("all");
  const [sort, setSort] = useState<SortKey>("stars");

  const hasFilters =
    search.trim() !== "" || topic !== "all" || language !== "all";

  const clearFilters = () => {
    setSearch("");
    setTopic("all");
    setLanguage("all");
  };

  const results = useMemo<Project[]>(() => {
    const needle = search.trim().toLowerCase();
    const matched = (data?.items ?? []).filter((item) => {
      if (language !== "all" && item.language !== language) return false;
      if (topic !== "all" && !item.topics.includes(topic)) return false;
      if (!needle) return true;
      return (
        item.fullName.toLowerCase().includes(needle) ||
        (item.description ?? "").toLowerCase().includes(needle) ||
        (item.language ?? "").toLowerCase().includes(needle) ||
        item.topics.some((entry) => entry.toLowerCase().includes(needle))
      );
    });

    return [...matched].sort((a, b) => {
      if (sort === "active") return (b.pushedAt ?? 0) - (a.pushedAt ?? 0);
      if (sort === "added") return b.firstSeenAt - a.firstSeenAt;
      if (sort === "name") return a.name.localeCompare(b.name);
      return b.stars - a.stars;
    });
  }, [data, search, topic, language, sort]);

  const visible = results.slice(0, VISIBLE_LIMIT);
  const isEmptyCatalog = data !== undefined && data !== null && data.total === 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader active="catalog" />

      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="mx-auto w-full max-w-6xl px-6 py-10 lg:py-12"
      >
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            Catalog
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Every project your topics have fetched so far — including the ones
            no longer in your feed. Search it, filter it, and rate what you
            find; ratings show up on your dashboard.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-3 border-y border-border py-4 sm:flex-row sm:items-center">
          <div className="relative sm:max-w-sm sm:flex-1">
            <Search
              aria-hidden
              className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search projects, languages or topics"
              aria-label="Search the catalog"
              className="h-9 pl-9 text-sm"
            />
            {search !== "" && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <Select value={topic} onValueChange={setTopic}>
              <SelectTrigger
                size="sm"
                className="w-[150px] text-xs"
                aria-label="Filter by topic"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All topics</SelectItem>
                {(data?.topics ?? []).map((entry) => (
                  <SelectItem key={entry.name} value={entry.name}>
                    {entry.name} ({entry.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger
                size="sm"
                className="w-[150px] text-xs"
                aria-label="Filter by language"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All languages</SelectItem>
                {(data?.languages ?? []).map((entry) => (
                  <SelectItem key={entry.name} value={entry.name}>
                    {entry.name} ({entry.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={sort}
              onValueChange={(value) => setSort(value as SortKey)}
            >
              <SelectTrigger
                size="sm"
                className="w-[150px] text-xs"
                aria-label="Sort catalog"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORTS) as SortKey[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {SORTS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={clearFilters}
              >
                <X className="size-3.5" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {data === undefined ? (
          <Loading label="Opening the catalog…" />
        ) : isEmptyCatalog ? (
          <div className="mt-6 rounded-lg border border-dashed border-border px-6 py-12 text-center">
            <p className="text-sm font-medium">Your catalog is empty</p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Add a couple of topics on your dashboard and fetch a batch.
              Everything GitHub returns lands here, ready to search and rate.
            </p>
            <Button className="mt-5 gap-2" asChild>
              <Link to="/dashboard">Go to your dashboard</Link>
            </Button>
          </div>
        ) : (
          <>
            <p className="pt-4 pb-1 text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
              {results.length} project{results.length === 1 ? "" : "s"}
              {hasFilters ? " matching" : " in total"}
              {results.length > VISIBLE_LIMIT
                ? ` · showing the first ${VISIBLE_LIMIT}`
                : ""}
            </p>

            {results.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-border px-6 py-12 text-center">
                <p className="text-sm font-medium">Nothing matches those filters</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  Try a shorter search term, or widen the topic and language
                  filters.
                </p>
                <Button variant="outline" className="mt-5" onClick={clearFilters}>
                  Clear filters
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {visible.map((item) => (
                  <RepoRow
                    key={item.repoId}
                    item={item}
                    onRate={rate}
                    onClear={clear}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </motion.main>
    </div>
  );
}
