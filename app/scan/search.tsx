"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type GuestRow = { key: string; name: string | null };

type Props = {
  guests: GuestRow[];
  /** guestKey → ISO check-in time ("" when the time isn't known on this phone). */
  checkedIn: Map<string, string>;
  /** True while the latest statuses are being fetched from the server. */
  syncing: boolean;
  onCheckIn: (key: string) => void;
  /** Resolves "ok" when undone, "gone" if they weren't checked in, "error" if offline. */
  onUndo: (key: string) => Promise<"ok" | "gone" | "error">;
  onClose: () => void;
};

const MAX_RESULTS = 40;
const RECENT = 8;
const CONFIRM_MS = 4000;

/** Lowercase, accents stripped, punctuation to spaces: "José  D'Souza" → "jose d souza". */
function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type Indexed = GuestRow & { n: string; words: string[] };

/**
 * Ranks a guest against the query. Every typed word must match — as the start
 * of a word in their name (strong) or anywhere in it (weak) — so "priya s"
 * finds "Priya Sharma" and "Sharma Priya" but not "Priya Iyer".
 */
function score(g: Indexed, q: string, tokens: string[]): number {
  let total = g.n.startsWith(q) ? 10 : 0;
  for (const t of tokens) {
    if (g.words.some((w) => w.startsWith(t))) total += 3;
    else if (g.n.includes(t)) total += 1;
    else return 0;
  }
  return total;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(d);
}

export default function GuestSearch({ guests, checkedIn, syncing, onCheckIn, onUndo, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const index = useMemo<Indexed[]>(
    () =>
      guests.map((g) => {
        const n = normalise(g.name ?? "");
        return { ...g, n, words: n.split(" ") };
      }),
    [guests],
  );

  const q = normalise(query);

  const results = useMemo(() => {
    if (!q) return [];
    const tokens = q.split(" ");
    return index
      .map((g) => ({ g, s: score(g, q, tokens) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || (a.g.name ?? "").localeCompare(b.g.name ?? ""))
      .slice(0, MAX_RESULTS)
      .map((r) => r.g);
  }, [index, q]);

  // With nothing typed, show the latest arrivals: the likeliest thing to need
  // undoing is the tap that just happened.
  const recent = useMemo(() => {
    if (q) return [];
    const names = new Map(guests.map((g) => [g.key, g.name]));
    return [...checkedIn.entries()]
      .filter(([, at]) => at)
      .sort((a, b) => b[1].localeCompare(a[1]))
      .slice(0, RECENT)
      .map(([key]) => ({ key, name: names.get(key) ?? null }));
  }, [q, checkedIn, guests]);

  useEffect(() => {
    // Focus after the slide-in starts; focusing during mount makes iOS jump.
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // A pending "tap again to undo" expires, so a stray second tap much later
  // can't reverse someone.
  useEffect(() => {
    if (!confirmKey) return;
    const t = setTimeout(() => setConfirmKey(null), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirmKey]);

  const undo = async (key: string) => {
    if (confirmKey !== key) {
      setConfirmKey(key);
      return;
    }
    setConfirmKey(null);
    setBusyKey(key);
    const result = await onUndo(key);
    setBusyKey(null);
    setNote(
      result === "error"
        ? "No connection — undo needs the network. Try again in a moment."
        : result === "gone"
          ? "They weren't checked in any more — another desk already changed it."
          : null,
    );
  };

  const inCount = checkedIn.size;
  const rows = q ? results : recent;

  return (
    <div className="find" role="dialog" aria-modal="true" aria-label="Find a guest">
      <div className="find-head">
        <input
          ref={inputRef}
          className="find-input"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Search by name"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setNote(null);
          }}
        />
        <button className="find-close" onClick={onClose}>
          Done
        </button>
      </div>

      <p className="find-meta">
        {guests.length} on the list · {inCount} in
        {syncing && <span className="find-sync"> · updating…</span>}
      </p>

      {note && <p className="find-note">{note}</p>}

      <div className="find-list">
        {!q && rows.length > 0 && <p className="find-label">Recently checked in</p>}

        {!q && rows.length === 0 && (
          <p className="find-empty">Type a name to find someone on the guest list.</p>
        )}

        {q && rows.length === 0 && (
          <p className="find-empty">
            No one matching “{query.trim()}”.
            <br />
            Only people registered and approved on Luma are on the list.
          </p>
        )}

        {rows.map((g) => {
          const at = checkedIn.get(g.key);
          const isIn = at !== undefined;
          const busy = busyKey === g.key;
          const confirming = confirmKey === g.key;
          return (
            <div key={g.key} className={`find-row${isIn ? " find-row--in" : ""}`}>
              <div className="find-who">
                <span className="find-name">{g.name || "Unnamed guest"}</span>
                <span className={`find-status${isIn ? " find-status--in" : ""}`}>
                  {isIn ? `In${timeLabel(at) ? ` · ${timeLabel(at)}` : ""}` : "Not in yet"}
                </span>
              </div>
              {isIn ? (
                <button
                  className={`find-act find-act--undo${confirming ? " find-act--confirm" : ""}`}
                  disabled={busy}
                  onClick={() => void undo(g.key)}
                >
                  {busy ? "Undoing…" : confirming ? "Tap to confirm" : "Undo"}
                </button>
              ) : (
                <button className="find-act find-act--in" onClick={() => onCheckIn(g.key)}>
                  Check in
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
