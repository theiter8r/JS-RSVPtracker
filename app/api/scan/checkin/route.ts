import { checkIn, logScan, type CheckInResult } from "@/lib/checkin";
import { GUEST_KEY } from "@/lib/qr";

export const dynamic = "force-dynamic";

type Scan = {
  guestKey: string;
  /** When the phone decoded it — may be minutes ago if it sat in the offline queue. */
  scannedAt?: string;
  /** A well-formed QR for a different Luma event: logged, never checked in. */
  foreign?: boolean;
  /** Found by name in the search sheet rather than scanned. */
  manual?: boolean;
};

/**
 * Records one or more scans.
 *
 * Batched because the offline queue flushes everything it accumulated during a
 * wifi outage at once, and a hundred separate requests over a recovering
 * connection is exactly how you turn a brief outage into a long one.
 *
 * Idempotent per guest: re-sending a scan that already landed returns
 * `duplicate`, so a client that retries after an ambiguous timeout is safe.
 */
export async function POST(req: Request) {
  let body: { device?: string; scans?: Scan[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const device = typeof body.device === "string" ? body.device.slice(0, 64) : null;
  const scans = Array.isArray(body.scans) ? body.scans : [];

  if (!scans.length) return Response.json({ error: "No scans" }, { status: 400 });
  if (scans.length > 500) return Response.json({ error: "Too many scans" }, { status: 413 });

  const results: CheckInResult[] = [];

  // Sequential, not Promise.all: the pool caps at 5 connections and a flush of
  // 200 queued scans would otherwise queue up behind itself anyway.
  for (const scan of scans) {
    const key = typeof scan?.guestKey === "string" ? scan.guestKey : "";
    if (!GUEST_KEY.test(key)) continue;

    const at = scan.scannedAt ? new Date(scan.scannedAt) : null;
    const scannedAt = at && !Number.isNaN(at.getTime()) ? at : null;

    if (scan.foreign) {
      await logScan(key, "foreign", device, scannedAt);
      results.push({ guestKey: key, outcome: "foreign", name: null, checkedInAt: null });
      continue;
    }

    results.push(await checkIn(key, device, scannedAt, scan.manual ? "manual" : "scan"));
  }

  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
