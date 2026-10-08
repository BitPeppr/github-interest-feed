import { cn } from "@/lib/utils";

/**
 * Presentation bits shared by every project surface — feed cards, catalog
 * rows, saved lists, shared pages — so the look cannot drift apart as the
 * product grows.
 */

/** GitHub's language colours, the only spot of colour on a quiet card. */
const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572a5",
  Go: "#00add8",
  Rust: "#dea584",
  Java: "#b07219",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Shell: "#89e051",
  Ruby: "#701516",
  PHP: "#4f5d95",
  Swift: "#f05138",
  Kotlin: "#a97bff",
  Dart: "#00b4ab",
  Zig: "#ec915c",
  Lua: "#000080",
  Elixir: "#6e4a7e",
  Haskell: "#5e5086",
  HTML: "#e34c26",
  CSS: "#563d7c",
  SCSS: "#c6538c",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Astro: "#ff5a03",
  "Jupyter Notebook": "#da5b0b",
  Clojure: "#db5855",
  OCaml: "#ef7a08",
  Nim: "#ffc200",
  R: "#198ce7",
  Julia: "#a270ba",
  PowerShell: "#012456",
  Dockerfile: "#384d54",
  Makefile: "#427819",
  Nix: "#7e7eff",
  Solidity: "#aa6746",
  TeX: "#3d6117",
  MDX: "#fcb32c",
};

/** A language dot plus its name. Renders nothing without a language. */
export function LanguageDot({ language }: { language: string | null }) {
  if (!language) return null;
  const color = LANGUAGE_COLORS[language] ?? "var(--muted-foreground)";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="size-2.5 rounded-full ring-1 ring-current/10"
        style={{ backgroundColor: color }}
      />
      {language}
    </span>
  );
}

/** GitHub topic chips — one chip style everywhere. */
export function TopicChips({
  topics,
  count = 6,
  className,
}: {
  topics: string[];
  count?: number;
  className?: string;
}) {
  if (topics.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {topics.slice(0, count).map((topic) => (
        <span
          key={topic}
          className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          {topic}
        </span>
      ))}
    </div>
  );
}
