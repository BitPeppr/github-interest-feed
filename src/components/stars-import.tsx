import { useState } from "react";
import { useAction } from "convex/react";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/format";

/**
 * Import a GitHub user's public stars as an instant taste profile: every
 * starred project becomes an implicit 4/5 rating the feed learns from.
 */
export function StarsImport() {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const importStars = useAction(api.github.importStars);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const clean = username.trim().replace(/^@/, "");
    if (!clean) return;
    setBusy(true);
    try {
      const result = await importStars({ username: clean });
      toast.success(
        `Imported ${result.imported} starred projects from @${clean}.`,
        {
          description:
            result.skipped > 0
              ? `${result.skipped} were already in your history — your own ratings always win.`
              : "Your feed is personalized from this moment.",
        },
      );
      setUsername("");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
        github.com/
      </span>
      <Input
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        placeholder="your-username"
        aria-label="GitHub username"
        className="h-9 w-40"
      />
      <Button
        type="submit"
        size="sm"
        disabled={busy || !username.trim()}
        className="gap-1.5"
      >
        <Download className="size-3.5" />
        {busy ? "Importing…" : "Import stars"}
      </Button>
    </form>
  );
}
