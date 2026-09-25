import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = {
  email: string;
  name: string | null;
  status: string;
  responded_at: Date | null;
  luma_api_id: string | null;
  registered_at: Date | null;
  invited_at: Date | null;
  source_row: Record<string, string> | null;
};

/**
 * Escapes one CSV field.
 *
 * The leading-apostrophe guard stops a value like `=HYPERLINK(...)` from being
 * evaluated as a formula when the export is opened in Excel or Sheets.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

type AttendeeRow = {
  name: string | null;
  email: string | null;
  guest_key: string;
  luma_guest_id: string | null;
  checked_in_at: Date | null;
  checked_in_by: string | null;
};

const ist = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat("sv-SE", {
        dateStyle: "short",
        timeStyle: "medium",
        timeZone: "Asia/Kolkata",
      }).format(new Date(d))
    : "";

/**
 * The door export: who actually walked in, and when.
 *
 * Separate from the RSVP export below because it answers a different question
 * from a different table — and because it's the one you'll want on the Sunday,
 * when Luma's own dashboard still says nobody checked in.
 */
async function attendeesCsv(onlyCheckedIn: boolean): Promise<Response> {
  const rows = await query<AttendeeRow>(
    `SELECT name, email, guest_key, luma_guest_id, checked_in_at, checked_in_by
       FROM attendees
      WHERE ($1::boolean IS NOT TRUE OR checked_in_at IS NOT NULL)
      ORDER BY checked_in_at DESC NULLS LAST, name`,
    [onlyCheckedIn],
  );

  const lines = [
    csvRow(["name", "email", "checked_in_at_ist", "checked_in_by", "guest_key", "luma_guest_id"]),
  ];
  for (const r of rows) {
    lines.push(
      csvRow([
        r.name,
        r.email,
        ist(r.checked_in_at),
        r.checked_in_by,
        r.guest_key,
        r.luma_guest_id,
      ]),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const name = `js-mumbai-3-${onlyCheckedIn ? "checked-in" : "guest-list"}-${stamp}.csv`;

  return new Response("\ufeff" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  if (kind === "checked_in") return attendeesCsv(true);
  if (kind === "attendees") return attendeesCsv(false);

  const statusParam = url.searchParams.get("status") || "all";
  const full = url.searchParams.get("full") === "1";

  const status = ["yes", "no", "pending"].includes(statusParam) ? statusParam : "";

  const rows = await query<Row>(
    `SELECT p.email, p.name, p.status, p.responded_at, p.luma_api_id, p.registered_at,
            (SELECT max(sent_at) FROM email_sends e
              WHERE e.participant_id = p.id AND e.status = 'sent') AS invited_at,
            p.source_row
       FROM participants p
      WHERE ($1 = '' OR p.status = $1)
      ORDER BY p.status, p.responded_at DESC NULLS LAST, p.email`,
    [status],
  );

  // Human-readable status labels — this file is read by people, and pasted into Luma.
  const label = (s: string) =>
    s === "yes" ? "Coming" : s === "no" ? "Not coming" : "No response";

  const base = ["email", "name", "status", "responded_at_ist", "invited_at_ist", "luma_api_id", "registered_at"];

  // `full=1` re-attaches every column from the original CSV import, so the export
  // can be diffed against (or re-uploaded alongside) the Luma guest list.
  const extraKeys = full
    ? [...new Set(rows.flatMap((r) => Object.keys(r.source_row || {})))].filter(
        (k) => !base.includes(k.toLowerCase()),
      )
    : [];

  const lines = [csvRow([...base, ...extraKeys])];
  for (const r of rows) {
    lines.push(
      csvRow([
        r.email,
        r.name,
        label(r.status),
        ist(r.responded_at),
        ist(r.invited_at),
        r.luma_api_id,
        r.registered_at,
        ...extraKeys.map((k) => r.source_row?.[k] ?? ""),
      ]),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const name = `js-mumbai-3-${statusParam}-${stamp}.csv`;

  // The BOM makes Excel open UTF-8 names (e.g. Devanagari) correctly.
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
