/**
 * Imports the Luma guest list into `attendees` — the door's lookup table.
 *
 *   npx tsx scripts/import-guests.ts --dry-run
 *   npx tsx scripts/import-guests.ts
 *   npx tsx scripts/import-guests.ts --file data/guests.json
 *
 * `data/guests.json` is produced by pulling the Luma event through the Luma
 * connector; the app itself holds no Luma credentials and never calls Luma.
 *
 * Re-running is safe and additive: a guest keeps their row, and `checked_in_at`
 * is never touched. That matters — you may well re-import on the morning of the
 * event, after people have already started walking through the door.
 */
import { arg, flag, c } from "./_bootstrap";
import { readFileSync } from "node:fs";
import { pool } from "../lib/db";

type Guest = {
  guest_key: string;
  luma_guest_id: string | null;
  ticket_id: string | null;
  name: string | null;
  email: string | null;
};

const GUEST_KEY = /^g-[A-Za-z0-9_-]{8,64}$/;

async function main() {
  const file = arg("file") || "data/guests.json";
  const dryRun = flag("dry-run");

  let guests: Guest[];
  try {
    guests = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(c.red(`Could not read ${file}: ${(err as Error).message}`));
    console.error(c.dim("Pull the guest list through the Luma connector first."));
    process.exit(1);
  }

  if (!Array.isArray(guests)) {
    console.error(c.red(`${file} is not a JSON array.`));
    process.exit(1);
  }

  // Reject the whole file rather than silently importing 890 of 899 rows: a
  // missing key means someone walks up to the door and gets a red screen.
  const bad = guests.filter((g) => !g?.guest_key || !GUEST_KEY.test(g.guest_key));
  if (bad.length) {
    console.error(c.red(`${bad.length} record(s) have a missing or malformed guest_key.`));
    console.error(c.dim(JSON.stringify(bad.slice(0, 3), null, 2)));
    process.exit(1);
  }

  const unique = new Map(guests.map((g) => [g.guest_key, g]));
  const dupes = guests.length - unique.size;

  console.log(`${c.bold(String(guests.length))} records in ${c.cyan(file)}`);
  if (dupes) console.log(c.yellow(`  ${dupes} duplicate guest_key(s) collapsed`));

  if (dryRun) {
    console.log(c.dim("\n--dry-run: nothing written. First record:"));
    console.log(c.dim(JSON.stringify(guests[0], null, 2)));
    await pool.end();
    return;
  }

  const before = await pool.query<{ count: string }>("SELECT count(*) FROM attendees");

  // One statement, unnested arrays: 899 rows in a single round trip rather than
  // 899 of them. COALESCE keeps an existing name when a later pull omits it.
  const rows = [...unique.values()];
  await pool.query(
    `INSERT INTO attendees (guest_key, luma_guest_id, ticket_id, name, email, synced_at)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[]),
                   LATERAL (SELECT now()) AS s(synced_at)
     ON CONFLICT (guest_key) DO UPDATE SET
       luma_guest_id = COALESCE(EXCLUDED.luma_guest_id, attendees.luma_guest_id),
       ticket_id     = COALESCE(EXCLUDED.ticket_id,     attendees.ticket_id),
       name          = COALESCE(EXCLUDED.name,          attendees.name),
       email         = COALESCE(EXCLUDED.email,         attendees.email),
       synced_at     = now()`,
    [
      rows.map((g) => g.guest_key),
      rows.map((g) => g.luma_guest_id ?? null),
      rows.map((g) => g.ticket_id ?? null),
      rows.map((g) => g.name ?? null),
      rows.map((g) => g.email ?? null),
    ],
  );

  const after = await pool.query<{ count: string; checked_in: string }>(
    `SELECT count(*) AS count,
            count(*) FILTER (WHERE checked_in_at IS NOT NULL) AS checked_in
       FROM attendees`,
  );

  const added = Number(after.rows[0].count) - Number(before.rows[0].count);
  console.log(
    c.green(`\n✓ attendees: ${after.rows[0].count} total (${added} new, ` +
      `${rows.length - added} updated), ${after.rows[0].checked_in} checked in`),
  );

  await pool.end();
}

main().catch((err) => {
  console.error(c.red(String(err)));
  process.exit(1);
});
