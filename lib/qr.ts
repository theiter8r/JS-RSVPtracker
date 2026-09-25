import { EVENT } from "./event";

/**
 * Parsing and validating the QR code on a Luma ticket.
 *
 * Luma hands each guest a check-in QR whose payload is a plain URL:
 *
 *     https://luma.com/check-in/evt-QHXOdahGbvATs1P?pk=g-Iu7Eqttp48Z6qGw
 *
 * The `pk` is the guest key — the opaque, per-guest identifier that also
 * resolves through Luma's own API. Nothing here is secret to us, so validation
 * is purely structural: the right host, the right event, a plausible key.
 *
 * The event check is the load-bearing part. Without it a ticket from any other
 * Luma event in the world scans green, because every Luma QR has this shape.
 */

export type QrResult =
  | { ok: true; guestKey: string }
  /**
   * A well-formed Luma check-in QR, but for a different event. The key is carried
   * through so the scan log can tell repeat offenders from distinct people.
   */
  | { ok: false; reason: "foreign"; eventId: string; guestKey: string | null }
  /** Not a Luma check-in QR at all — a website, a WiFi code, a UPI string. */
  | { ok: false; reason: "malformed" };

const LUMA_HOSTS = new Set(["luma.com", "www.luma.com", "lu.ma", "www.lu.ma"]);

/** Guest keys observed as `g-` plus 15 base62 characters. Kept loose on length. */
export const GUEST_KEY = /^g-[A-Za-z0-9_-]{8,64}$/;

export function parseLumaQr(raw: string): QrResult {
  const text = raw.trim();
  if (!text) return { ok: false, reason: "malformed" };

  // Some ticket renderings encode the bare key rather than the full URL. Accept
  // it: there is no event to check, but the key is still unambiguous to us.
  if (GUEST_KEY.test(text)) return { ok: true, guestKey: text };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (!LUMA_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, reason: "malformed" };
  }

  // Path is /check-in/<event id>. Trailing slashes and casing both turn up.
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0].toLowerCase() !== "check-in") {
    return { ok: false, reason: "malformed" };
  }

  const eventId = parts[1];
  const guestKey = url.searchParams.get("pk") || "";

  // Order matters: report the wrong event even when the key is also junk, so the
  // volunteer is told "different event" rather than a useless "invalid code".
  if (eventId !== EVENT.lumaId) {
    return {
      ok: false,
      reason: "foreign",
      eventId,
      guestKey: GUEST_KEY.test(guestKey) ? guestKey : null,
    };
  }
  if (!GUEST_KEY.test(guestKey)) return { ok: false, reason: "malformed" };

  return { ok: true, guestKey };
}
