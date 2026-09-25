import { query } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * The live headcount, polled by the display every couple of seconds.
 *
 * Secret-gated rather than password-protected so a TV, a spare laptop or someone's
 * phone can show the number without anyone typing credentials into it.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;
  if (secret !== env.countSecret) {
    return new Response("Not found", { status: 404 });
  }

  const [row] = await query<{ count: string }>(
    `SELECT count(*) AS count FROM attendees WHERE checked_in_at IS NOT NULL`,
  );

  return Response.json(
    { count: Number(row?.count ?? 0), at: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
