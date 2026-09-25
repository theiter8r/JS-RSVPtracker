"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useWakeLock } from "@/lib/use-wake-lock";

/** How often to ask the server for the number. */
const POLL_MS = 2000;

/**
 * Seven-segment geometry on a 100 x 180 grid.
 *
 *    aaa
 *   f   b
 *    ggg
 *   e   c
 *    ddd
 */
const T = 18; // segment thickness

const hSeg = (cy: number, x0: number, x1: number) =>
  `${x0},${cy} ${x0 + T / 2},${cy - T / 2} ${x1 - T / 2},${cy - T / 2} ${x1},${cy} ` +
  `${x1 - T / 2},${cy + T / 2} ${x0 + T / 2},${cy + T / 2}`;

const vSeg = (cx: number, y0: number, y1: number) =>
  `${cx},${y0} ${cx + T / 2},${y0 + T / 2} ${cx + T / 2},${y1 - T / 2} ${cx},${y1} ` +
  `${cx - T / 2},${y1 - T / 2} ${cx - T / 2},${y0 + T / 2}`;

const SEGMENTS: Record<string, string> = {
  a: hSeg(9, 4, 96),
  b: vSeg(91, 13, 86),
  c: vSeg(91, 94, 167),
  d: hSeg(171, 4, 96),
  e: vSeg(9, 94, 167),
  f: vSeg(9, 13, 86),
  g: hSeg(90, 4, 96),
};

/** Which segments are lit for each digit. A blank leaves every segment dark. */
const DIGITS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgecd",
  "7": "abc",
  "8": "abcdefg",
  "9": "abfgcd",
  " ": "",
};

/**
 * Room around the 100 x 180 digit for the glow to spread into. Without it the
 * blur is cut off at the SVG's edge and the lit digit sits in a hard-edged box.
 */
const PAD = 14;

function Digit({ char, pulse }: { char: string; pulse: number }) {
  const lit = DIGITS[char] ?? "";
  const glowId = `glow-${useId().replace(/:/g, "")}`;
  const on = Object.entries(SEGMENTS).filter(([name]) => lit.includes(name));

  return (
    <svg
      className="digit"
      viewBox={`${-PAD} ${-PAD} ${100 + PAD * 2} ${180 + PAD * 2}`}
      aria-hidden
    >
      <defs>
        {/* userSpaceOnUse + an explicit region: the default filter region is
            the element's bounding box plus 10%, which would clip the blur. */}
        <filter
          id={glowId}
          filterUnits="userSpaceOnUse"
          x={-PAD}
          y={-PAD}
          width={100 + PAD * 2}
          height={180 + PAD * 2}
        >
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {/* Every segment, faintly: the ghosting that makes it read as a panel. */}
      {Object.entries(SEGMENTS).map(([name, points]) => (
        <polygon key={name} points={points} className="seg" />
      ))}

      {/* One blurred copy of the lit segments behind the crisp ones. Keyed on
          the pulse so each change remounts it and replays the flash. */}
      <g key={pulse} className={pulse ? "glow glow--pulse" : "glow"} filter={`url(#${glowId})`}>
        {on.map(([name, points]) => (
          <polygon key={name} points={points} />
        ))}
      </g>

      {on.map(([name, points]) => (
        <polygon key={name} points={points} className="seg seg--on" />
      ))}
    </svg>
  );
}

export default function Led({ initial, secret }: { initial: number; secret: string }) {
  const [count, setCount] = useState(initial);
  const [stale, setStale] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const prevRef = useRef(initial);
  const [pulseAt, setPulseAt] = useState(0);

  useWakeLock();

  // --- polling --------------------------------------------------------------

  useEffect(() => {
    let alive = true;

    const poll = async () => {
      try {
        const res = await fetch(`/api/count/${secret}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body: { count: number } = await res.json();
        if (!alive) return;
        setCount(body.count);
        setStale(false);
      } catch {
        // Keep showing the last known number rather than blanking the display;
        // just mark it, so nobody trusts a frozen figure for an hour.
        if (alive) setStale(true);
      }
    };

    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [secret]);

  // Flash the digits whenever the number moves.
  useEffect(() => {
    if (count !== prevRef.current) {
      prevRef.current = count;
      setPulseAt(Date.now());
    }
  }, [count]);

  useEffect(() => {
    setCanFullscreen(
      typeof document !== "undefined" && !!document.documentElement.requestFullscreen,
    );
  }, []);

  const goFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
      // Landscape is where this is meant to live; failure here is fine.
      await (
        screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
      ).lock?.("landscape");
    } catch {
      // Denied, or iOS — which has no Fullscreen API at all. The Home Screen
      // install is the real answer there; see the hint below.
    }
  }, []);

  // Pad so the panel keeps a constant width and unused places show as ghosts,
  // exactly like a physical counter.
  const text = String(count).padStart(3, " ");
  const chars = [...text];

  return (
    <main className="count">
      <div className="count-digits" role="status" aria-live="polite" aria-label={`${count} checked in`}>
        {chars.map((char, i) => (
          <Digit key={i} char={char} pulse={char === " " ? 0 : pulseAt} />
        ))}
      </div>

      {stale && <p className="count-stale">reconnecting…</p>}

      {canFullscreen && (
        <button className="count-fs" onClick={() => void goFullscreen()}>
          Fullscreen
        </button>
      )}
      <p className="count-hint">
        On iPhone, use Share → Add to Home Screen, then open it from there for a full screen.
      </p>
    </main>
  );
}
