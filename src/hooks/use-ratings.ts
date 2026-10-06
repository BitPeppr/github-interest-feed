import { useCallback } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/format";

/** Rate and un-rate projects; shared by the dashboard and the catalog. */
export function useRatings() {
  const setRating = useMutation(api.feed.setRating);
  const clearRating = useMutation(api.feed.clearRating);

  const rate = useCallback(
    (repoId: number, value: number) => {
      void setRating({ repoId, value }).catch((error) =>
        toast.error(errorText(error)),
      );
    },
    [setRating],
  );

  const clear = useCallback(
    (repoId: number) => {
      void clearRating({ repoId }).catch((error) =>
        toast.error(errorText(error)),
      );
    },
    [clearRating],
  );

  return { rate, clear };
}
