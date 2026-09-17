/**
 * Imports the participant CSV into `participants`, one token per person.
 *
 *   npx tsx scripts/import-csv.ts --file data/guests.csv --dry-run
 *   npx tsx scripts/import-csv.ts --file data/guests.csv
 *   npx tsx scripts/import-csv.ts --file data/guests.csv --filter "approval_status=pending_approval"
 *
 * The exact column names of the export aren't known ahead of time, so headers are
 * fuzzy-matched and the resolved mapping is printed for confirmation before anything
 * is written. Every untouched column is preserved in `source_row`.
 */
import { arg, flag, c, confirm } from "./_bootstrap";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { pool } from "../lib/db";
import { generateToken } from "../lib/tokens";
import { RESPONSE_WINDOW_HOURS } from "../lib/event";

type Csv = Record<string, string>;

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

/** Returns the first header whose normalised form matches one of `patterns`, in order. */
function pick(headers: string[], patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const hit = headers.find((h) => pattern.test(h.trim().toLowerCase()));
    if (hit) return hit;
  }
  return undefined;
}

function main() {
  const file = arg("file");
  const dryRun = flag("dry-run");
  const autoYes = flag("yes");
  const windowHours = Number(arg("expires-hours") || RESPONSE_WINDOW_HOURS);

  if (!file) {
    console.error("Usage: tsx scripts/import-csv.ts --file <path.csv> [--dry-run] [--filter col=value]");
    process.exit(1);
  }

  const raw = readFileSync(file, "utf8").replace(/^﻿/, ""); // strip Excel BOM
  const rows: Csv[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  });

  if (rows.length === 0) {
    console.error(c.red("The CSV has no data rows."));
    process.exit(1);
  }

  const headers = Object.keys(rows[0]);

  const map = {
    email: pick(headers, [/^e-?mail$/, /^email address$/, /e-?mail/]),
    name: pick(headers, [/^name$/, /^full ?name$/, /^guest ?name$/, /name/]),
    firstName: pick(headers, [/^first ?name$/]),
    lastName: pick(headers, [/^last ?name$/, /^surname$/]),
    lumaId: pick(headers, [/^api ?_?id$/, /^guest ?_?id$/, /api_?id/]),
    registeredAt: pick(headers, [
      /^registered ?_?at$/,
      /^created ?_?at$/,
      /registration ?date/,
      /registered/,
      /^date$/,
    ]),
  };

  console.log(`\n${c.bold("File")}        ${file}`);
  console.log(`${c.bold("Rows")}        ${rows.length}`);
  console.log(`${c.bold("Columns")}     ${headers.join(", ")}\n`);
  console.log(c.bold("Resolved column mapping"));
  console.log(`  email         ← ${map.email ? c.green(map.email) : c.red("NOT FOUND")}`);
  console.log(
    `  name          ← ${
      map.name
        ? c.green(map.name)
        : map.firstName
          ? c.green(`${map.firstName}${map.lastName ? ` + ${map.lastName}` : ""}`)
          : c.yellow("none (emails will be un-personalised)")
    }`,
  );
  console.log(`  luma_api_id   ← ${map.lumaId ? c.green(map.lumaId) : c.dim("none")}`);
  console.log(`  registered_at ← ${map.registeredAt ? c.green(map.registeredAt) : c.dim("none")}`);
  console.log(c.dim("  everything else is preserved in source_row\n"));

  if (!map.email) {
    console.error(c.red("No email column found — cannot continue. Rename the column or edit the mapping."));
    process.exit(1);
  }

  // Show the spread of any status-ish column, so it's obvious whether the export
  // contains approved/declined guests as well as pending ones.
  for (const h of headers) {
    if (!/status|approval/i.test(h)) continue;
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r[h] || "(blank)", (counts.get(r[h] || "(blank)") || 0) + 1);
    const spread = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join("  ");
    console.log(`${c.bold(`Breakdown of "${h}"`)}  ${spread}`);
  }

  // Optional filters: --filter "approval_status=pending_approval" (repeatable)
  const filters: { column: string; value: string }[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i];
    const spec = a === "--filter" ? process.argv[i + 1] : a.startsWith("--filter=") ? a.slice(9) : "";
    if (!spec || !spec.includes("=")) continue;
    const eq = spec.indexOf("=");
    filters.push({ column: spec.slice(0, eq).trim(), value: spec.slice(eq + 1).trim().toLowerCase() });
  }

  let working = rows;
  for (const f of filters) {
    const before = working.length;
    working = working.filter((r) => (r[f.column] || "").trim().toLowerCase() === f.value);
    console.log(`\n${c.bold("Filter")}      ${f.column} = ${f.value}  →  ${working.length} of ${before} rows kept`);
  }

  // Normalise, validate, dedupe.
  const seen = new Map<string, number>();
  const invalid: string[] = [];
  let duplicates = 0;

  const records = working
    .map((r) => {
      const email = (r[map.email!] || "").trim().toLowerCase();
      const name =
        (map.name ? r[map.name] : "") ||
        [map.firstName ? r[map.firstName] : "", map.lastName ? r[map.lastName] : ""]
          .filter(Boolean)
          .join(" ");
      const registered = map.registeredAt ? r[map.registeredAt] : "";
      const parsedDate = registered ? new Date(registered) : null;

      return {
        email,
        name: (name || "").trim() || null,
        lumaId: (map.lumaId ? r[map.lumaId] : "")?.trim() || null,
        registeredAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
        sourceRow: r,
      };
    })
    .filter((r) => {
      if (!EMAIL_RE.test(r.email)) {
        invalid.push(r.email || "(blank)");
        return false;
      }
      if (seen.has(r.email)) {
        duplicates++;
        return false;
      }
      seen.set(r.email, 1);
      return true;
    });

  console.log(`\n${c.bold("Ready to import")}`);
  console.log(`  ${c.green(String(records.length))} unique valid participants`);
  if (duplicates) console.log(`  ${c.yellow(String(duplicates))} duplicate emails skipped`);
  if (invalid.length) {
    console.log(`  ${c.yellow(String(invalid.length))} rows without a valid email skipped`);
    console.log(c.dim(`    e.g. ${invalid.slice(0, 5).join(", ")}`));
  }

  console.log(`\n${c.bold("First 5 mapped rows")}`);
  for (const r of records.slice(0, 5)) {
    console.log(`  ${(r.name || c.dim("(no name)")).padEnd(28)} ${r.email}`);
  }

  return { records, dryRun, autoYes, windowHours };
}

async function run() {
  const { records, dryRun, autoYes, windowHours } = main();

  if (dryRun) {
    console.log(c.cyan("\n--dry-run: nothing was written.\n"));
    await pool.end();
    return;
  }

  if (!autoYes) {
    const ok = await confirm(`\nInsert ${records.length} participants into the database?`);
    if (!ok) {
      console.log("Aborted.");
      await pool.end();
      return;
    }
  }

  const expiresAt = new Date(Date.now() + windowHours * 3600_000);
  let inserted = 0;
  const CHUNK = 500;

  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((r, j) => {
      const b = j * 7;
      values.push(r.email, r.name, r.lumaId, r.registeredAt, generateToken(), expiresAt, JSON.stringify(r.sourceRow));
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}::jsonb)`;
    });

    // Re-importing an updated export is additive: existing people keep their token
    // (so already-delivered links never break) and keep their recorded answer.
    const { rowCount } = await pool.query(
      `INSERT INTO participants (email, name, luma_api_id, registered_at, token, token_expires_at, source_row)
       VALUES ${tuples.join(", ")}
       ON CONFLICT (email) DO NOTHING`,
      values,
    );
    inserted += rowCount || 0;
    process.stdout.write(`\r  inserted ${inserted} / ${records.length}`);
  }

  const { rows: totals } = await pool.query<{ count: string }>("SELECT count(*) FROM participants");
  console.log(
    `\n\n${c.green("Done.")} ${inserted} new, ${records.length - inserted} already present. ` +
      `Database now holds ${totals[0].count} participants.`,
  );
  console.log(c.dim(`Links expire ${expiresAt.toISOString()} (${windowHours}h from now).\n`));
  await pool.end();
}

run().catch((err) => {
  console.error(c.red(`\n${err.message}`));
  process.exit(1);
});
