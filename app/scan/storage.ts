/**
 * The scanner's local state.
 *
 * All of it is a cache of something the server already knows, so any read may
 * come back empty and every write may throw — private browsing, a full disk, a
 * wiped site. Nothing here is allowed to break the door, hence the try/catch
 * around every access and the plain fallbacks.
 */

const KEYS = {
  guests: "jsm3.guests.v1",
  checkedIn: "jsm3.checkedin.v1",
  queue: "jsm3.queue.v1",
  device: "jsm3.device.v1",
} as const;

export type QueuedScan = {
  guestKey: string;
  scannedAt: string;
  foreign?: boolean;
  /** Checked in from the search sheet rather than scanned. */
  manual?: boolean;
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Out of quota or blocked. The scan still works; it just won't survive a reload.
  }
}

/** `[guestKey, name]` tuples, as served by /api/scan/manifest. */
export type GuestTuple = [string, string | null];

export const loadGuests = (): GuestTuple[] => read<GuestTuple[]>(KEYS.guests, []);
export const saveGuests = (g: GuestTuple[]) => write(KEYS.guests, g);

export const loadCheckedIn = (): string[] => read<string[]>(KEYS.checkedIn, []);
export const saveCheckedIn = (keys: Iterable<string>) => write(KEYS.checkedIn, [...keys]);

export const loadQueue = (): QueuedScan[] => read<QueuedScan[]>(KEYS.queue, []);
export const saveQueue = (q: QueuedScan[]) => write(KEYS.queue, q);

/**
 * A stable label for this phone, so `checked_in_by` can tell three desks apart
 * afterwards. Random rather than asked-for: nobody is naming their device at 09:55.
 */
export function deviceLabel(): string {
  let label = read<string>(KEYS.device, "");
  if (!label) {
    label = `desk-${Math.random().toString(36).slice(2, 6)}`;
    write(KEYS.device, label);
  }
  return label;
}
