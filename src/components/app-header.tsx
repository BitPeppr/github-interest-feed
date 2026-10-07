import { Link, useNavigate } from "react-router";
import { LogOut } from "lucide-react";

import { Wordmark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/feed", label: "Explore", key: "feed" },
  { href: "/dashboard", label: "Saved", key: "dashboard" },
] as const;

export type AppSection = (typeof NAV)[number]["key"];

/** Shared header for the signed-in pages. */
export function AppHeader({ active }: { active: AppSection }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-6">
        <div className="flex h-full items-center gap-5 sm:gap-8">
          <Link
            to="/"
            aria-label="Gitbook home"
            className="flex items-center"
          >
            <Wordmark nameClassName="hidden sm:inline" />
          </Link>

          <nav className="flex h-full items-center gap-5">
            {NAV.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                aria-current={active === item.key ? "page" : undefined}
                className={cn(
                  "flex h-14 items-center border-b-2 text-sm transition-colors",
                  active === item.key
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden max-w-[200px] truncate text-xs text-muted-foreground lg:block">
            {user?.email ?? "Guest session"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground hover:text-foreground"
            onClick={() => void handleSignOut()}
          >
            <LogOut className="size-3.5" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
