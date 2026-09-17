import { NextResponse, type NextRequest } from "next/server";

/**
 * HTTP Basic auth over the admin surface.
 *
 * Runs on the edge runtime, so this deliberately avoids `node:crypto` and uses a
 * hand-rolled constant-time comparison instead of `timingSafeEqual`.
 */
function safeEqual(a: string, b: string): boolean {
  // Compare a fixed number of characters so the loop length leaks nothing.
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function unauthorized() {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="JS Mumbai RSVP admin", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

export function proxy(req: NextRequest) {
  const expectedUser = process.env.ADMIN_USER;
  const expectedPassword = process.env.ADMIN_PASSWORD;

  // Fail closed: an unconfigured admin password must lock the door, not open it.
  if (!expectedUser || !expectedPassword) {
    return new NextResponse(
      "Admin is not configured. Set ADMIN_USER and ADMIN_PASSWORD on the deployment.",
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("basic ")) return unauthorized();

  let decoded = "";
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return unauthorized();
  }

  const sep = decoded.indexOf(":");
  if (sep === -1) return unauthorized();

  const user = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);

  // Both comparisons always run — no early return on a username mismatch.
  const okUser = safeEqual(user, expectedUser);
  const okPassword = safeEqual(password, expectedPassword);
  if (!okUser || !okPassword) return unauthorized();

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
