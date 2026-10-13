"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Re-renders the current page after each worker cycle (every ~4 min), without a full reload:
 * checks /api/heartbeat every 30 s and calls router.refresh() when a new cycle has finished.
 * Also refreshes when the tab comes back into view. Skips while the user is typing in a field.
 */
export function AutoRefresh() {
  const router = useRouter();
  const last = useRef<number | null>(null);
  useEffect(() => {
    let stop = false;
    const check = async (force = false) => {
      try {
        const r = await fetch("/api/heartbeat", { cache: "no-store" });
        const { at } = (await r.json()) as { at: number | null };
        const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
        if (!stop && at && (force || (last.current !== null && at !== last.current)) && !typing) router.refresh();
        last.current = at;
      } catch { /* offline: try again next tick */ }
    };
    void check();
    const id = setInterval(() => { if (document.visibilityState === "visible") void check(); }, 30_000);
    const onVis = () => { if (document.visibilityState === "visible") void check(true); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [router]);
  return null;
}
