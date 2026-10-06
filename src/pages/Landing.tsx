import { motion } from "framer-motion";
import { GitFork, Star } from "lucide-react";
import { Link } from "react-router";

import { Wordmark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";
import { INTEREST_LABELS } from "@/components/feed/interest-scale";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

const FEED_PATH = "/auth?returnTo=%2Fdashboard";

/** Static sample rows that show what the feed looks like. */
const PREVIEW_ROWS = [
  {
    owner: "oven-sh",
    name: "bun",
    description: "A fast all-in-one JavaScript runtime, bundler and test runner.",
    language: "TypeScript",
    stars: "74k",
    forks: "2.1k",
    rating: 4,
  },
  {
    owner: "astral-sh",
    name: "uv",
    description:
      "An extremely fast Python package and project manager, written in Rust.",
    language: "Rust",
    stars: "41k",
    forks: "1.1k",
    rating: 5,
  },
  {
    owner: "tldraw",
    name: "tldraw",
    description: "Infinite canvas SDK for building collaborative whiteboards.",
    language: "TypeScript",
    stars: "38k",
    forks: "2.4k",
    rating: null,
  },
];

const STEPS = [
  {
    number: "01",
    title: "Pick your topics",
    body: "Choose the GitHub topics you care about. Those topics are the entire definition of your feed.",
  },
  {
    number: "02",
    title: "Fetch a batch",
    body: "GitHub Interest Feed asks GitHub for the most-starred projects under those topics and files them in your catalog.",
  },
  {
    number: "03",
    title: "Rate each project",
    body: "Say how interested you are, from 1 to 5. Every rating is stored against the project and stays yours.",
  },
];

const INSIDE = [
  {
    title: "Your dashboard",
    body: "Your topics, your feed, and a running total of what you have rated — all on one quiet page.",
  },
  {
    title: "The catalog",
    body: "Every project fetched so far, searchable by name, language or topic and filterable down to the interesting few.",
  },
  {
    title: "Your ratings",
    body: "A 1 – 5 interest score per project. Ratings are private to your account and are the only signal this feed needs.",
  },
];

const IN_V1 = [
  "Sign up or log in with your email, then rate straight away",
  "A feed defined only by the topics you pick",
  "A catalog you can browse, search and filter",
  "A 1 – 5 interest rating on every project, with totals on your dashboard",
];

const LATER = [
  "Recommendations learned from your ratings",
  "Following other people or sharing lists",
  "Comments, likes and notifications",
  "Anything that needs a feed algorithm you cannot read",
];

function PreviewScale({ value }: { value: number | null }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((level) => (
          <span
            key={level}
            className={cn(
              "flex size-5 items-center justify-center rounded-full border",
              value === level ? "border-foreground" : "border-border",
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                value !== null && level <= value
                  ? "bg-foreground"
                  : "bg-transparent",
              )}
            />
          </span>
        ))}
      </div>
      <span className="w-[68px] truncate text-xs text-muted-foreground">
        {value ? INTEREST_LABELS[value - 1] : "Rate"}
      </span>
    </div>
  );
}

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
      {children}
    </p>
  );
}

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const primaryHref = isAuthenticated ? "/dashboard" : FEED_PATH;
  const primaryLabel = isAuthenticated ? "Go to your dashboard" : "Create your feed";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-6">
          <Link to="/" aria-label="GitHub Interest Feed home">
            <Wordmark nameClassName="hidden sm:inline" />
          </Link>
          <nav className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="hidden text-muted-foreground hover:text-foreground md:inline-flex"
              asChild
            >
              <Link to="/catalog">Catalog</Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="hidden text-muted-foreground hover:text-foreground sm:inline-flex"
              asChild
            >
              <a href="#how">How it works</a>
            </Button>
            {!isAuthenticated && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                asChild
              >
                <Link to={FEED_PATH}>Sign in</Link>
              </Button>
            )}
            <Button size="sm" asChild>
              <Link to={primaryHref}>
                {isAuthenticated ? "Dashboard" : "Create your feed"}
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto w-full max-w-5xl px-6 pt-20 pb-16 sm:pt-28">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="max-w-2xl"
          >
            <MicroLabel>A personal GitHub feed</MicroLabel>
            <h1 className="mt-6 text-4xl font-semibold tracking-[-0.03em] text-balance sm:text-5xl lg:text-6xl">
              A GitHub feed you tune by hand.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
              GitHub Interest Feed pulls projects from the topics you choose and
              asks one question about each: how interested are you? No timeline
              to keep up with, and no algorithm you cannot read.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" asChild>
                <Link to={primaryHref}>{primaryLabel}</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#how">See how it works</a>
              </Button>
            </div>
            <p className="mt-5 text-xs text-muted-foreground">
              Sign up or log in with an email code · Built for one person: you
            </p>
          </motion.div>

          {/* Feed preview */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: "easeOut" }}
            className="mt-16 rounded-xl border border-border sm:mt-20"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <MicroLabel>Your feed</MicroLabel>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                3 of 40 · topics: rust, typescript
              </span>
            </div>
            <ul className="divide-y divide-border">
              {PREVIEW_ROWS.map((row) => (
                <li
                  key={row.name}
                  className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:gap-10"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium tracking-[-0.01em]">
                      <span className="text-muted-foreground">{row.owner}</span>
                      <span className="text-muted-foreground/50"> / </span>
                      {row.name}
                    </p>
                    <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {row.description}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full bg-foreground/50"
                        />
                        {row.language}
                      </span>
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Star className="size-3.5" aria-hidden />
                        {row.stars}
                      </span>
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <GitFork className="size-3.5" aria-hidden />
                        {row.forks}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <PreviewScale value={row.rating} />
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-border px-5 py-3">
              <p className="text-[11px] text-muted-foreground">
                Rate a page in a minute. That is the whole loop.
              </p>
            </div>
          </motion.div>
        </section>

        {/* How it works */}
        <section id="how" className="border-t border-border scroll-mt-14">
          <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:py-24">
            <MicroLabel>How it works</MicroLabel>
            <h2 className="mt-5 max-w-xl text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl">
              Three steps, then the feed takes care of itself.
            </h2>

            <ol className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
              {STEPS.map((step) => (
                <li key={step.number} className="bg-background p-6 sm:p-7">
                  <span className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground">
                    {step.number}
                  </span>
                  <h3 className="mt-4 text-base font-medium tracking-[-0.01em]">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* What is inside */}
        <section className="border-t border-border">
          <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:py-24">
            <MicroLabel>What is inside</MicroLabel>
            <h2 className="mt-5 max-w-xl text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl">
              Three pages, one loop.
            </h2>

            <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
              {INSIDE.map((item) => (
                <div key={item.title} className="bg-background p-6 sm:p-7">
                  <h3 className="text-base font-medium tracking-[-0.01em]">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Scope */}
        <section className="border-t border-border">
          <div className="mx-auto grid w-full max-w-5xl gap-12 px-6 py-20 sm:py-24 lg:grid-cols-2 lg:gap-20">
            <div>
              <MicroLabel>In version 1</MicroLabel>
              <h2 className="mt-5 text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl">
                Small on purpose.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Version 1 does one thing well: it shows you a GitHub feed and
                lets you rate it.
              </p>
              <ul className="mt-8 divide-y divide-border border-y border-border">
                {IN_V1.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 py-3 text-sm leading-relaxed"
                  >
                    <span
                      aria-hidden
                      className="mt-[7px] size-1 shrink-0 rounded-full bg-foreground"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:pt-[76px]">
              <MicroLabel>Deliberately not yet</MicroLabel>
              <ul className="mt-8 divide-y divide-border border-y border-border">
                {LATER.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 py-3 text-sm leading-relaxed text-muted-foreground"
                  >
                    <span
                      aria-hidden
                      className="mt-[7px] size-1 shrink-0 rounded-full border border-muted-foreground"
                    />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
                Ratings come first because they are the only signal the feed
                needs later.
              </p>
            </div>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="border-t border-border">
          <div className="mx-auto w-full max-w-5xl px-6 py-20 text-center sm:py-28">
            <h2 className="mx-auto max-w-xl text-3xl font-semibold tracking-[-0.025em] text-balance">
              Your next favourite project is one rating away.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
              Pick two topics, rate ten projects, and your feed starts to look
              like something you would have chosen yourself.
            </p>
            <div className="mt-8 flex justify-center">
              <Button size="lg" asChild>
                <Link to={primaryHref}>{primaryLabel}</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
          <Wordmark />
          <p className="text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
            Version 1 · Topics, catalog and ratings
          </p>
        </div>
      </footer>
    </div>
  );
}
