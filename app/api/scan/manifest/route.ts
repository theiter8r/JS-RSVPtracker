import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = { guest_key: string; name: string | null; checked_in_at: Date | null };

/**
 * The offline cache the scanner loads once on startup.
 *
 * Shipping the whole guest list to the device is the point: a scan then resolves
 * to a name and a green screen with no network at all, which is the difference
 * between a working door and a queue in a lobby when the venue wifi folds.
 *
 * The payload is deliberately minimal — key, name, and whether they're already in.
 * No emails: this sits in localStorage on a volunteer's personal phone.
 */
export async function GET() {
  const rows = await query<Row>(
    `SELECT guest_key, name, checked_in_at FROM attendees ORDER BY guest_key`,
  );

  return Response.json(
    {
      syncedAt: new Date().toISOString(),
      // Tuples rather than objects: ~899 of these, and it halves the transfer.
      guests: rows.map((r) => [r.guest_key, r.name] as const),
      checkedIn: rows.filter((r) => r.checked_in_at).map((r) => r.guest_key),
      // Same set with times, for the search sheet's "In · 10:04". A separate
      // field rather than a change to `checkedIn`, so a phone still running
      // the previous build keeps working.
      checkedInTimes: rows
        .filter((r) => r.checked_in_at)
        .map((r) => [r.guest_key, new Date(r.checked_in_at!).toISOString()] as const),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
