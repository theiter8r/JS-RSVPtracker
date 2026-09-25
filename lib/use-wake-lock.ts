"use client";

import { useEffect } from "react";

type SentinelLike = { release: () => Promise<void> };

/**
 * Holds the screen awake while the page is visible.
 *
 * Both surfaces that use this run unattended for hours — a count display on a
 * spare phone, a scanner on a volunteer's phone between arrivals — and the
 * default behaviour of both is to lock the screen after thirty seconds.
 *
 * The lock is dropped by the browser whenever the tab is hidden, so it has to be
 * re-acquired on every return to visibility rather than taken once.
 */
export function useWakeLock(active = true): void {
  useEffect(() => {
    if (!active) return;

    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<SentinelLike> };
    };
    if (!nav.wakeLock) return; // Not supported — the screen will dim. Nothing to do.

    let sentinel: SentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await nav.wakeLock!.request("screen");
        if (cancelled) void next.release();
        else sentinel = next;
      } catch {
        // Denied, or the battery saver has other ideas.
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", acquire);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
