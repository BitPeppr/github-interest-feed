import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  // useSyncExternalStore keeps render pure: no setState-in-effect, and the
  // value stays in sync with the media query on resize.
  return React.useSyncExternalStore(
    (callback) => {
      const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
      mql.addEventListener("change", callback);
      return () => mql.removeEventListener("change", callback);
    },
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false,
  );
}
