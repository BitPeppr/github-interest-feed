import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";

import { AppHeader } from "@/components/app-header";
import { Loading } from "@/components/feed/loading";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { formatCompact } from "@/lib/format";

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="bg-background p-6 sm:p-7">
      <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
      {note && <p className="mt-2 text-sm text-muted-foreground">{note}</p>}
    </div>
  );
}

export default function Wrapped() {
  const data = useQuery(api.collections.wrapped);
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    void navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader active="wrapped" />
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-12"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Your year in review
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Wrapped
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The numbers behind your taste — worth a screenshot.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={copyLink}>
              {copied ? "Link copied" : "Copy link"}
            </Button>
            <Button asChild variant="outline">
              <Link to={user ? `/u/${user._id}` : "/feed"}>
                Your public shelf
              </Link>
            </Button>
          </div>
        </div>

        {data === undefined ? (
          <Loading label="Counting your year…" />
        ) : data.totalRated === 0 && data.imported === 0 ? (
          <div className="py-20 text-center">
            <h2 className="text-lg font-medium">Nothing to review yet</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              Rate a few projects — or import your GitHub stars — and your year
              takes shape here.
            </p>
            <Button asChild className="mt-5">
              <Link to="/feed">Explore projects</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
              <Stat
                label="Projects rated"
                value={String(data.totalRated)}
                note={
                  data.averageInterest != null
                    ? `Average interest ${data.averageInterest}/5`
                    : undefined
                }
              />
              <Stat
                label="Saved for later"
                value={String(data.saved)}
                note={`${data.hidden} skipped along the way`}
              />
              <Stat
                label="Taste imported"
                value={String(data.imported)}
                note="Starred projects turned into ratings"
              />
              <Stat
                label="Your language"
                value={data.topLanguage ?? "—"}
                note="The one you rated most"
              />
              <Stat
                label="Topics you loved"
                value={
                  data.topTopics.length > 0 ? data.topTopics.join(", ") : "—"
                }
                note="From your highest-rated projects"
              />
              <Stat
                label="Stars you discovered"
                value={formatCompact(data.totalStars)}
                note="Across everything you rated"
              />
            </div>

            <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
              <Stat
                label="Your earliest sighting"
                value={data.firstSighting?.fullName ?? "—"}
                note={
                  data.firstSighting
                    ? `The first project you ever rated (${data.firstSighting.value}/5)`
                    : undefined
                }
              />
              <Stat
                label="Your top pick"
                value={data.topPick?.fullName ?? "—"}
                note={
                  data.topPick
                    ? `Rated ${data.topPick.value}/5 — the highest thing here`
                    : undefined
                }
              />
            </div>

            <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Make the shelf public and this page is the story it tells.
              </p>
              <div className="flex items-center gap-2">
                <Button asChild variant="outline">
                  <Link to="/collections">Your collections</Link>
                </Button>
                <Button asChild>
                  <Link to="/feed">Keep exploring</Link>
                </Button>
              </div>
            </div>
          </>
        )}
      </motion.main>
    </div>
  );
}
