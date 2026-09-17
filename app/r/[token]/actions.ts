"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { pool } from "@/lib/db";
import type { ParticipantStatus } from "@/lib/db";

/**
 * Records a response. Invoked only from a <form> POST — never from a GET — so that
 * link scanners and inbox prefetchers cannot confirm anyone by accident.
 *
 * Always finishes with a redirect (Post/Redirect/Get). Without it the browser sits on
 * the POST response, and a reload re-submits the form — which, because the page then
 * offers the OPPOSITE answer as a "changed your mind?" button, would silently toggle
 * someone's response every time they refreshed the tab.
 */
export async function respond(formData: FormData): Promise<void> {
  const token = String(formData.get("token") || "");
  const answer = String(formData.get("answer") || "");

  // Nothing to record — bounce back to the page, which explains the situation.
  if (!token || (answer !== "yes" && answer !== "no")) redirect(`/r/${token}`);
  const to: ParticipantStatus = answer;

  const h = await headers();
  // Vercel sets x-forwarded-for; take the left-most (the real client).
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  const ua = h.get("user-agent")?.slice(0, 500) || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the row so two rapid clicks can't interleave, and re-check expiry
    // server-side: a stale page in someone's tab must not beat the deadline.
    const { rows } = await client.query<{ id: number; status: ParticipantStatus }>(
      `SELECT id, status FROM participants
        WHERE token = $1 AND token_expires_at > now()
        FOR UPDATE`,
      [token],
    );

    // An unknown or expired token records nothing; the page below says which it was.
    if (rows.length === 0) {
      await client.query("ROLLBACK");
    } else {
      const { id, status: from } = rows[0];

      if (from === to) {
        // Re-submitting the same answer changes nothing and writes no audit row.
        await client.query("ROLLBACK");
      } else {
        await client.query(
          `UPDATE participants
              SET status = $2, responded_at = now(), response_ip = $3, response_ua = $4
            WHERE id = $1`,
          [id, to, ip, ua],
        );

        await client.query(
          `INSERT INTO response_events (participant_id, from_status, to_status, ip, user_agent)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, from, to, ip, ua],
        );

        await client.query("COMMIT");
      }
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  revalidatePath(`/r/${token}`);

  // Post/Redirect/Get: leave the browser on a GET so a refresh is harmless.
  redirect(`/r/${token}`);
}
