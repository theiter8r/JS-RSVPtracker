import { undoCheckIn } from "@/lib/checkin";
import { GUEST_KEY } from "@/lib/qr";

export const dynamic = "force-dynamic";

/**
 * Reverses one check-in. Behind the same Basic auth as the rest of /api/scan.
 *
 * Deliberately online-only — no offline queue. An undo replayed minutes later,
 * after the person has been legitimately scanned again, would silently remove
 * a valid check-in.
 */
export async function POST(req: Request) {
  let body: { guestKey?: string; device?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const key = typeof body.guestKey === "string" ? body.guestKey : "";
  if (!GUEST_KEY.test(key)) return Response.json({ error: "Bad guest key" }, { status: 400 });
  const device = typeof body.device === "string" ? body.device.slice(0, 64) : null;

  return Response.json(await undoCheckIn(key, device), { headers: { "Cache-Control": "no-store" } });
}
