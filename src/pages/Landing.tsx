import { useState } from "react";
import { motion } from "framer-motion";
import { Bookmark, GitFork, Star } from "lucide-react";
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
    owner: "kata0510",
    name: "Lily58",
    description:
      "6	imes4+4 keys column-staggered split keyboard.",
    language: "Unknown",
    stars: "2.3k",
    forks: "1.2k",
    heading: "Before the Sofle",
    readme:
      "The Lily58 is the ancestor of the Sofle. 4 rows on each side, 4 keys on the middle column, a middle column per side — at least two palm keys. No little OLED per side, no caps-lock Blinky, less room under the case; the Sofle put those in and got more thumb keys on the job. This is where the hobby went: 6 columns on each hand and one column down the middle.",
    rating: 4,
  },
  {
    owner: "BitPeppr",
    name: "TriSolaris",
    description:
      "A three-body problem visualiser, renderer and configuration finder — gravitational chaos from a real initial state.",
    language: "Unknown",
    stars: "0",
    forks: "0",
    heading: "Stable or chaotic",
    readme:
      "Three-body problem visualiser and configuration finder. Two bodies are calm; three is where gravity starts to look like it has a personality — so the solver runs the numbers until it finds a state that stays together for the time you asked for, then renders it.",
    rating: 5,
  },
];

/** Real corners of GitHub the feed explores, sampled from its topic list. */
const TOPIC_TAGS = [
  "keyboards",
  "tui",
  "physics",
  "screensavers",
  "synthesis",
  "compilers",
  "generative-art",
  "emulators",
  "self-hosted",
  "raytracing",
  "midi",
  "e-ink",
];

const STEPS = [
  {
    number: "01",
    title: "Scroll the feed",
    body: "An endless feed of projects from all over GitHub, one card at a time. The next one is already loading.",
  },
  {
    number: "02",
    title: "Rate what you see",
    body: "Every card arrives with its description, screenshots and README. Give it a score from 1 to 5 in about a second.",
  },
  {
    number: "03",
    title: "Save the keepers",
    body: "Bookmark the projects worth coming back to, skip the rest, and the feed picks up on both.",
  },
];

/** The three beats of the loop, not three pages — there are two of those. */
const INSIDE = [
  {
    title: "Your feed",
    body: "One card at a time: screenshots, the README and a rating. Scroll past anything and it will not come back.",
  },
  {
    title: "Saved projects",
    body: "Everything you bookmarked, in one list — plus collections you can shape into shelves and share by link.",
  },
  {
    title: "It keeps up with you",
    body: "Rate, save or skip and the feed shifts: more of what you liked, less of what you did not, plus a slice reserved for corners of GitHub you have not met.",
  },
];

const IN_V1 = [
  "Sign up or log in with an email code, then start rating",
  "Import your GitHub stars as an instant taste profile",
  "An endless feed of GitHub projects with their READMEs and screenshots",
  "A 1 – 5 interest rating, plus save and dismiss on every card",
  "Projects ranked by growth — see them before they are big",
  "Collections you can share by link, a public shelf, and a yearly wrapped",
];

const LATER = [
  "Following other people and their shelves",
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

function PreviewCard({
  card,
  tilt,
}: {
  card: (typeof PREVIEW_CARDS)[number];
  tilt: string;
}) {
  const [mediaBroken, setMediaBroken] = useState(false);

  return (
    <article
      className={cn(
        "rounded-xl border border-border bg-card transition-transform duration-300 hover:rotate-0",
        tilt,
      )}
    >
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
          <p className="mt-2 text-sm leading-relaxed text-foreground/90">
            {card.readme}
          </p>
        </div>
      </div>

      <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-border bg-background/90 px-5 py-3">
        <div className="flex items-center gap-3">
          <PreviewScale value={card.rating} />
          <span className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground">
            {card.rating}/5
          </span>
        </div>
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

export default function Landing() {
  const { user, isAuthenticated, signOut } = useAuth();
  // One destination for the one call to action: straight in when signed in,
  // through the auth page (which returns you to /feed) when signed out.
  const exploreHref = isAuthenticated ? "/feed" : FEED_PATH;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-6">
          <Link to="/" aria-label="Gitbook home">
            <Wordmark nameClassName="hidden sm:inline" />
          </Link>
          <nav className="flex items-center gap-1.5">
            {user?.isAnonymous === true && (
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
              <Link to={exploreHref}>Explore</Link>
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
            <MicroLabel>An endless feed of GitHub projects</MicroLabel>
            <h1 className="mt-6 text-4xl font-semibold tracking-[-0.03em] text-balance sm:text-5xl lg:text-6xl">
              Social media, but for{" "}
              <span className="relative inline-block">
                GitHub.
                <svg
                  aria-hidden
                  viewBox="0 0 220 12"
                  preserveAspectRatio="none"
                  className="absolute -bottom-1 left-0 h-2.5 w-full overflow-visible"
                >
                  <motion.path
                    d="M3 7 C 60 2, 120 11, 217 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: 0.9, delay: 0.55, ease: "easeInOut" }}
                  />
                </svg>
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
              Scroll projects instead of posts. Rate what you like, save what
              you will come back to, skip the rest. No timeline, nothing to
              post, nothing to keep up with.
            </p>
            <div className="mt-8">
              <Button size="lg" asChild>
                <Link to={exploreHref}>Explore</Link>
              </Button>
            </div>
            <p className="mt-5 text-xs text-muted-foreground">
              Sign up or log in with an email code · Built for one person: you
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-2">
              <span className="mr-1 font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
                Waiting for you
              </span>
              {TOPIC_TAGS.map((topic) => (
                <span
                  key={topic}
                  className="rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  {topic}
                </span>
              ))}
            </div>
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
                Live from GitHub · 2 of 2 rated
              </span>
            </div>
            <div className="mx-auto max-w-2xl space-y-6 sm:space-y-8">
              {PREVIEW_CARDS.map((card, i) => (
                <PreviewCard
                  key={card.name}
                  card={card}
                  tilt={i === 0 ? "-rotate-[0.5deg]" : "rotate-[0.6deg]"}
                />
              ))}
            </div>
            <p className="mt-6 text-center text-[11px] text-muted-foreground">
              These are real projects from GitHub, not placeholders.
              The real feed loads them as you go.
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
              A few pages, one loop.
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
              <MicroLabel>In Gitbook today</MicroLabel>
              <h2 className="mt-5 text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl">
                Small on purpose.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Gitbook does one thing well: it shows you projects from GitHub
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
              Rate ten projects and your feed starts to look like yours.
            </p>
            <div className="mt-8 flex justify-center">
              <Button size="lg" asChild>
                <Link to={exploreHref}>Explore</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-8">
          <Wordmark />
          <p className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground">
            Made by someone who reads READMEs for fun.
          </p>
        </div>
      </footer>
    </div>
  );
}
