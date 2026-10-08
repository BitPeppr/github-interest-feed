import { Link, useParams } from "react-router";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { ExternalLink, Star } from "lucide-react";

import { Loading } from "@/components/feed/loading";
import { LanguageDot, TopicChips } from "@/components/feed/project-parts";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { api } from "@/convex/_generated/api";
import { formatCompact, formatRelative } from "@/lib/format";

export default function SharedCollection() {
  const { collectionId } = useParams();
  // Malformed ids are handled server-side: the query returns null and the page
  // below says "not available" instead of crashing on argument validation.
  const collection = useQuery(
    api.collections.shared,
    collectionId ? { collectionId } : "skip",
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-6">
          <Link to="/" aria-label="Gitbook home">
            <Wordmark />
          </Link>
          <Button size="sm" asChild>
            <Link to="/feed">Open your feed</Link>
          </Button>
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: "easeOut" }}
        className="mx-auto w-full max-w-5xl px-6 py-10 sm:py-14"
      >
        {!collectionId || (collection !== undefined && collection === null) ? (
          <div className="py-24 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              This collection is not available
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              It may be private, or the link may be wrong.
            </p>
            <Button asChild className="mt-6">
              <Link to="/feed">Open your feed</Link>
            </Button>
          </div>
        ) : collection === undefined ? (
          <Loading label="Loading collection…" />
        ) : (
          <>
            <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
              A Gitbook collection · by {collection.ownerName}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {collection.name}
            </h1>
            {collection.description && (
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
                {collection.description}
              </p>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              {collection.items.length}{" "}
              {collection.items.length === 1 ? "project" : "projects"} · curated
              on Gitbook
            </p>

            <ul className="mt-10 divide-y divide-border border-y border-border">
              {collection.items.map((item) => {
                const updated = formatRelative(item.pushedAt);
                return (
                  <li key={item.repoId} className="py-6">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-lg font-semibold tracking-tight underline-offset-4 hover:underline"
                    >
                      {item.fullName}
                    </a>
                    <p className="mt-2 text-sm leading-relaxed text-foreground">
                      {item.description || "No description provided."}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                      <LanguageDot language={item.language} />
                      <span className="inline-flex items-center gap-1">
                        <Star className="size-3.5" />
                        {formatCompact(item.stars)}
                      </span>
                      {updated && <span>Updated {updated}</span>}
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        <ExternalLink className="size-3.5" />
                        GitHub
                      </a>
                    </div>
                    <TopicChips topics={item.topics} count={6} className="mt-3" />
                  </li>
                );
              })}
            </ul>

            <div className="mt-12 flex justify-center">
              <Button asChild>
                <Link to="/feed">Explore projects like these</Link>
              </Button>
            </div>
          </>
        )}
      </motion.main>
    </div>
  );
}
