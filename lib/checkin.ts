import { query } from "./db";

export type CheckInOutcome = "ok" | "duplicate" | "unknown" | "foreign";

/** How the check-in happened: a QR scan, or a volunteer finding them by name. */
export type CheckInSource = "scan" | "manual";

export type CheckInResult = {
  guestKey: string;
  outcome: CheckInOutcome;
  name: string | null;
  /** For `duplicate`, the time of the ORIGINAL check-in — what the amber screen shows. */
  checkedInAt: Date | null;
};

type Row = {
  name: string | null;
  checked_in_at: Date | null;
  just_now: boolean;
};

/**
 * Marks one guest as checked in, exactly once.
 *
 * The `WHERE checked_in_at IS NULL` is what makes this safe when three phones
 * scan the same person at the same moment: Postgres arbitrates, one UPDATE
 * matches a row, the others match nothing. Whoever loses reads back the winner's
 * timestamp and shows amber.
 *
 * The UNION re-reads the row only when the UPDATE found nothing, so the common
 * path stays a single statement and a single round trip.
 */
export async function checkIn(
  guestKey: string,
  device: string | null,
  scannedAt?: Date | null,
  source: CheckInSource = "scan",
): Promise<CheckInResult> {
  const rows = await query<Row>(
    `WITH upd AS (
       UPDATE attendees SET checked_in_at = now(), checked_in_by = $2
        WHERE guest_key = $1 AND checked_in_at IS NULL
        RETURNING name, checked_in_at
     )
     SELECT name, checked_in_at, true AS just_now FROM upd
     UNION ALL
     SELECT name, checked_in_at, false FROM attendees
      WHERE guest_key = $1 AND NOT EXISTS (SELECT 1 FROM upd)`,
    [guestKey, device],
  );

  const row = rows[0];
  const outcome: CheckInOutcome = !row ? "unknown" : row.just_now ? "ok" : "duplicate";

  await logScan(guestKey, outcome, device, scannedAt, source);

  return {
    guestKey,
    outcome,
    name: row?.name ?? null,
    checkedInAt: row?.checked_in_at ?? null,
  };
}

/**
 * Appends to the scan log. Separate from `checkIn` because rejections that never
 * reach the database — a foreign event's QR — still belong in the log.
 *
 * Deliberately swallows its own errors: a failed audit write must never turn a
 * successful check-in into a red screen with a queue building up behind it.
 */
export async function logScan(
  guestKey: string | null,
  outcome: CheckInOutcome | "undo",
  device: string | null,
  scannedAt?: Date | null,
  source: CheckInSource = "scan",
): Promise<void> {
  try {
    await query(
      `INSERT INTO check_in_scans (guest_key, outcome, device, scanned_at, source)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), $5)`,
      [guestKey, outcome, device, scannedAt ?? null, source],
    );
  } catch (err) {
    console.error("[checkin] scan log failed", err);
  }
}

export type UndoResult = {
  guestKey: string;
  /** False if they weren't checked in to begin with (another desk got there first). */
  undone: boolean;
  name: string | null;
  /** Which device had checked them in, so that device can correct its own tally. */
  previousDevice: string | null;
};

/**
 * Reverses a check-in — for the tap on the wrong row, or the person who scanned
 * and then left. The count display drops by one on its next poll.
 *
 * The previous device is read in the same statement as the update, via a
 * self-join on the pre-update row, so there's no window for a race.
 */
export async function undoCheckIn(guestKey: string, device: string | null): Promise<UndoResult> {
  const rows = await query<{ name: string | null; previous_device: string | null }>(
    `UPDATE attendees a SET checked_in_at = NULL, checked_in_by = NULL
       FROM attendees prev
      WHERE a.guest_key = $1 AND prev.id = a.id AND a.checked_in_at IS NOT NULL
      RETURNING a.name, prev.checked_in_by AS previous_device`,
    [guestKey],
  );
  const row = rows[0];
  if (row) await logScan(guestKey, "undo", device, null, "manual");
  return {
    guestKey,
    undone: !!row,
    name: row?.name ?? null,
    previousDevice: row?.previous_device ?? null,
  };
}
