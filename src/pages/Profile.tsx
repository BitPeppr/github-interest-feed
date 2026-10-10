import { useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  Copy,
  ExternalLink,
  Globe,
  Lock,
  Star,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import { Loading } from "@/components/feed/loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wordmark } from "@/components/wordmark";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { errorText, formatCompact } from "@/lib/format";

export default function Profile() {
  const { userId } = useParams();
  const { isAuthenticated } = useAuth();

  // Malformed ids are handled server-side: the query returns null and the page
  // below says "not public" instead of crashing on argument validation.
  const profile = useQuery(
    api.collections.publicProfile,
    userId ? { userId } : "skip",
  );
  // Owner-only settings: skipped entirely for signed-out viewers so the
  // public page works without an account.
  const mine = useQuery(
    api.collections.myProfile,
    isAuthenticated ? {} : "skip",
  );
  const setProfile = useMutation(api.collections.setProfile);

  const [bio, setBio] = useState<string | null>(null);
  const bioValue = bio ?? mine?.bio ?? "";

  const run = (action: () => Promise<unknown>) => {
    void action().catch((error) => toast.error(errorText(error)));
  };

  const copyLink = () => {
    void navigator.clipboard
      .writeText(window.location.href)
      .then(() => toast.success("Profile link copied."))
      .catch(() => toast.error("Could not copy the link."));
  };

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
        {!userId || (profile !== undefined && profile === null) ? (
          <div className="py-24 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              This shelf is not public
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Profiles on Gitbook are private until their owner shares them.
            </p>
            <Button asChild className="mt-6">
              <Link to="/feed">Open your feed</Link>
            </Button>
          </div>
        ) : profile === undefined ? (
          <Loading label="Loading shelf…" />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
              <div>
                <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
                  {profile.isPublic
                    ? "Public shelf"
                    : "Private shelf · preview"}
                </p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight">
                  {profile.name}
                </h1>
                {profile.bio && (
                  <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                    {profile.bio}
                  </p>
                )}
              </div>
              {profile.isOwner && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={profile.isPublic ? "default" : "outline"}
                    className="gap-1.5"
                    onClick={() =>
                      run(() =>
                        setProfile({
                          isPublic: !profile.isPublic,
                          bio: bioValue || undefined,
                        }),
                      )
                    }
                  >
                    <Globe className="size-3.5" />
                    {profile.isPublic ? "Public" : "Private"}
                  </Button>
                  {profile.isPublic && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5"
                      onClick={copyLink}
                    >
                      <Copy className="size-3.5" />
                      Copy link
                    </Button>
                  )}
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/wrapped">Your year in review</Link>
                  </Button>
                </div>
              )}
            </div>

            {profile.isOwner && (
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <Input
                  value={bioValue}
                  onChange={(event) => setBio(event.target.value)}
                  placeholder="A line about your taste (optional)"
                  aria-label="Profile bio"
                  className="h-9 w-80"
                />
                <Button
                  size="sm"
                  onClick={() =>
                    run(() =>
                      setProfile({
                        isPublic: profile.isPublic,
                        bio: bioValue || undefined,
                      }),
                    )
                  }
                >
                  Save bio
                </Button>
                {!profile.isPublic && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock className="size-3.5" />
                    Only you can see this page while it is private.
                  </span>
                )}
              </div>
            )}

            <section className="mt-10">
              <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
                The shelf · rated 4-5
              </p>
              {profile.shelf.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Nothing on the shelf yet — the best-rated projects land here.
                </p>
              ) : (
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {profile.shelf.map((item) => (
                    <a
                      key={item.repoId}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-foreground/30"
                    >
                      <p className="truncate text-xs text-muted-foreground">
                        {item.owner}
                      </p>
                      <p className="mt-1 truncate text-base font-medium tracking-tight underline-offset-4 group-hover:underline">
                        {item.name}
                      </p>
                      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                        {item.description || "No description provided."}
                      </p>
                      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Star className="size-3.5" />
                          {formatCompact(item.stars)}
                        </span>
                        {item.starGrowth7d != null &&
                          item.starGrowth7d >= 40 && (
                            <span className="inline-flex items-center gap-1 text-foreground">
                              <TrendingUp className="size-3.5" />+
                              {formatCompact(item.starGrowth7d)} this week
                            </span>
                          )}
                        {item.language && <span>{item.language}</span>}
                        <span className="ml-auto">{item.rating}/5</span>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </section>

            {profile.collections.length > 0 && (
              <section className="mt-12">
                <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
                  Collections
                </p>
                <ul className="mt-4 divide-y divide-border border-y border-border">
                  {profile.collections.map((collection) => (
                    <li
                      key={collection._id}
                      className="flex items-center justify-between gap-3 py-4"
                    >
                      <div className="min-w-0">
                        <Link
                          to={`/c/${collection._id}`}
                          className="truncate text-base font-medium tracking-tight underline-offset-4 hover:underline"
                        >
                          {collection.name}
                        </Link>
                        {collection.description && (
                          <p className="mt-1 truncate text-sm text-muted-foreground">
                            {collection.description}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                        <span>
                          {collection.count}{" "}
                          {collection.count === 1 ? "project" : "projects"}
                        </span>
                        <Button size="sm" variant="ghost" asChild>
                          <Link to={`/c/${collection._id}`}>
                            <ExternalLink className="size-3.5" />
                            Open
                          </Link>
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </motion.main>
    </div>
  );
}
