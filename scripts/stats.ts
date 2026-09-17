/** Quick terminal snapshot of where the wave stands:  npx tsx scripts/stats.ts */
import { c } from "./_bootstrap";
import { pool } from "../lib/db";
import { EVENT } from "../lib/event";

async function main() {
  const { rows } = await pool.query<Record<string, string>>(`
  SELECT
    count(*)                                                    AS total,
    count(*) FILTER (WHERE status = 'yes')                      AS yes,
    count(*) FILTER (WHERE status = 'no')                       AS no,
    count(*) FILTER (WHERE status = 'pending')                  AS pending,
    count(*) FILTER (WHERE token_expires_at < now())            AS expired,
    (SELECT count(DISTINCT participant_id) FROM email_sends
      WHERE kind = 'invite'   AND status = 'sent')              AS invited,
    (SELECT count(DISTINCT participant_id) FROM email_sends
      WHERE kind = 'reminder' AND status = 'sent')              AS reminded
    FROM participants
  `);

  const s = rows[0];
  const n = (k: string) => Number(s[k] || 0);
  const answered = n("yes") + n("no");
  const rate = n("invited") ? Math.round((answered / n("invited")) * 100) : 0;

  console.log(`\n${c.bold(EVENT.name)}  ${c.dim(EVENT.dateLabel)}\n`);
  console.log(`  participants   ${String(n("total")).padStart(5)}`);
  console.log(`  invited        ${String(n("invited")).padStart(5)}`);
  console.log(`  reminded       ${String(n("reminded")).padStart(5)}`);
  console.log(`  ${c.green("coming")}         ${c.green(String(n("yes")).padStart(5))}`);
  console.log(`  ${c.yellow("not coming")}     ${c.yellow(String(n("no")).padStart(5))}`);
  console.log(`  no response    ${String(n("pending")).padStart(5)}`);
  console.log(`  response rate  ${String(rate).padStart(4)}%\n`);
  console.log(c.dim(`  ${n("expired")} link(s) past their deadline\n`));

  await pool.end();
}

main().catch((err) => {
  console.error(c.red(`\n${err.message}`));
  process.exit(1);
});
