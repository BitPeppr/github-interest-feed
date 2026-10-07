import { useState } from "react";
import { motion } from "framer-motion";
import { Bookmark, GitFork, Loader2, Star } from "lucide-react";
import { Link } from "react-router";

import { Wordmark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";
import { INTEREST_LABELS } from "@/components/feed/interest-scale";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

const FEED_PATH = "/auth?returnTo=%2Ffeed";

/** Sample cards that show what the feed looks like, using real GitHub art. */
const PREVIEW_CARDS = [
  {
    owner: "oven-sh",
    name: "bun",
    description:
      "A fast all-in-one JavaScript runtime, bundler, test runner and package manager.",
    language: "TypeScript",
    stars: "74k",
    forks: "2.1k",
    heading: "What is Bun?",
    readme:
      "Bun is an all-in-one toolkit for JavaScript and TypeScript apps. It ships as a single executable called bun, and at its core is a fast runtime designed as a drop-in replacement for Node.js.",
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
    heading: "Highlights",
    readme:
      "One tool to replace pip, pip-tools, pipx, poetry, pyenv and virtualenv. Ten to a hundred times faster than pip, with a global cache and a resolver that does not fight you.",
    rating: null,
  },
];

const STEPS = [
  {
    number: "01",
    title: "Scroll the feed",
    body: "A discovery feed drawn from all over GitHub and refreshed as you go. Following topics is optional — they only steer it.",
  },
  {
    number: "02",
    title: "Rate what you see",
    body: "Every card arrives with its description, screenshots and README. Give it a score from 1 to 5 in about a second.",
  },
  {
    number: "03",
    title: "Save the keepers",
    body: "Bookmark the projects worth coming back to and dismiss the rest. Your ratings shape what turns up next.",
  },
];

const INSIDE = [
  {
    title: "Your feed",
    body: "One card at a time: screenshots, the README, and a rating. Scroll past anything and it never returns.",
  },
  {
    title: "Endless discovery",
    body: "Everything the feed has turned up so far, searchable by name, language or topic.",
  },
  {
    title: "Your dashboard",
    body: "Your totals, the topics nudging the feed, and the projects you saved, rated or hid.",
  },
];

const IN_V1 = [
  "Sign up or log in with an email code, then start rating",
  "An endless feed of GitHub projects with their READMEs and screenshots",
  "A 1 – 5 interest rating, plus save and dismiss on every card",
  "One project at a time, with more picked from what you like as you explore",
];

const LATER = [
  "Following other people or sharing collections",
  "Comments, likes and notifications",
  "A ranking you cannot see the reasons for",
  "Sharing one account between several people",
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

function PreviewCard({ card }: { card: (typeof PREVIEW_CARDS)[number] }) {
  const [mediaBroken, setMediaBroken] = useState(false);

  return (
    <article className="rounded-xl border border-border bg-card">
      <header className="flex items-start gap-3 px-5 pt-5">
        <img
          src={`https://github.com/${card.owner}.png?size=80`}
          alt=""
          loading="lazy"
          className="size-9 shrink-0 rounded-full border border-border"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium tracking-[-0.01em]">
            <span className="text-muted-foreground">{card.owner}</span>
            <span className="text-muted-foreground/50"> / </span>
            {card.name}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {card.language} · {card.stars} stars
          </p>
        </div>
      </header>

      {!mediaBroken && (
        <div className="mt-4 border-y border-border bg-muted/30">
          <img
            src={`https://opengraph.githubassets.com/1/${card.owner}/${card.name}`}
            alt=""
            loading="lazy"
            onError={() => setMediaBroken(true)}
            className="h-40 w-full object-cover object-top"
          />
        </div>
      )}

      <div className="px-5 pt-4">
        <p className="text-sm leading-relaxed text-foreground/90">
          {card.description}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Star className="size-3.5" aria-hidden />
            {card.stars}
          </span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <GitFork className="size-3.5" aria-hidden />
            {card.forks}
          </span>
        </div>

        <div className="mt-5">
          <h3 className="text-base font-semibold tracking-[-0.01em] text-foreground">
            {card.heading}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {card.readme}
          </p>
        </div>
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-border bg-background/90 px-5 py-3">
        <PreviewScale value={card.rating} />
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <Bookmark className="size-3.5" />
          {card.rating ? "Saved" : "Save"}
        </span>
      </footer>
    </article>
  );
}

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
      {children}
    </p>
  );
}

/**
 * The main call to action. While the session is still resolving it renders a
 * spinner instead of a label, and both states reserve the same width, so the
 * page never changes its mind about whether you are signed in.
 */
function PrimaryCta({
  isLoading,
  href,
  label,
}: {
  isLoading: boolean;
  href: string;
  label: string;
}) {
  if (isLoading) {
    return (
      <Button size="lg" disabled className="min-w-[188px]">
        <Loader2 className="size-4 animate-spin" />
        <span className="sr-only">Checking your session…</span>
      </Button>
    );
  }
  return (
    <Button size="lg" className="min-w-[188px]" asChild>
      <Link to={href}>{label}</Link>
    </Button>
  );
}

export default function Landing() {
  const { user, isLoading, isAuthenticated, signOut } = useAuth();
  const primaryHref = isAuthenticated ? "/feed" : FEED_PATH;
  const primaryLabel = isAuthenticated ? "Open your feed" : "Create your account";

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
              <Link to="/feed">Explore</Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="hidden text-muted-foreground hover:text-foreground sm:inline-flex"
              asChild
            >
              <a href="#how">How it works</a>
            </Button>
            {isLoading ? (
              <span
                aria-hidden
                className="flex h-8 w-[124px] items-center justify-center"
              >
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </span>
            ) : !isAuthenticated ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  asChild
                >
                  <Link to={FEED_PATH}>Sign in</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link to={primaryHref}>{primaryLabel}</Link>
                </Button>
              </>
            ) : (
              <>
                {user?.isAnonymous && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => void signOut()}
                  >
                    Exit guest mode
                  </Button>
                )}
                <Button size="sm" asChild>
                  <Link to={primaryHref}>{primaryLabel}</Link>
                </Button>
              </>
            )}
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
              Rate projects from across GitHub and the feed answers back: save
              the ones worth keeping, dismiss the noise, and keep scrolling.
              There is no timeline to keep up with and no algorithm you cannot
              read.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <PrimaryCta isLoading={isLoading} href={primaryHref} label={primaryLabel} />
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
            className="mt-16 sm:mt-20"
          >
            <div className="mb-4 flex items-center justify-between">
              <MicroLabel>Your feed</MicroLabel>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                24 projects waiting · 2 rated
              </span>
            </div>
            <div className="mx-auto max-w-2xl space-y-6">
              {PREVIEW_CARDS.map((card) => (
                <PreviewCard key={card.name} card={card} />
              ))}
            </div>
            <p className="mt-6 text-center text-[11px] text-muted-foreground">
              Rate a card, scroll to the next. That is the whole loop.
            </p>
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
                Version 1 does one thing well: it shows you projects from GitHub
                and lets you rate them.
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
              Rate ten projects and your feed starts to look like something you
              would have chosen yourself.
            </p>
            <div className="mt-8 flex justify-center">
              <PrimaryCta isLoading={isLoading} href={primaryHref} label={primaryLabel} />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
          <Wordmark />
          <p className="text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
            Version 1 · Explore and saved projects
          </p>
        </div>
      </footer>
    </div>
  );
}
