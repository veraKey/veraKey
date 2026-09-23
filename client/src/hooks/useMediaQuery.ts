import { useEffect, useState } from "react";

/** Below this width the app uses its phone layout: tabs, and the phone flow on Pay (`.vk-compact`). */
export const COMPACT_QUERY = "(max-width: 820px)";

/** Whether a CSS media query currently matches; re-renders when that changes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}
