/**
 * Sends the confirmation emails, throttled and resumable.
 *
 *   npx tsx scripts/send-wave.ts --dry-run                      # render one email, send nothing
 *   npx tsx scripts/send-wave.ts --only you+test@gmail.com      # single live test
 *   npx tsx scripts/send-wave.ts --limit 400                    # a day's batch
 *   npx tsx scripts/send-wave.ts --kind reminder --limit 400    # nudge non-responders
 *
 * State lives in `email_sends` after every single send, so Ctrl-C, a crash or a
 * Gmail throttle all leave the run safely resumable — just run it again.
 */
import { arg, flag, c, confirm, sleep } from "./_bootstrap";
import nodemailer from "nodemailer";
import { pool } from "../lib/db";
import { env } from "../lib/env";
import { EVENT } from "../lib/event";
import { buildEmail, type Kind, type Recipient } from "./email-template";

/** Gmail's hard ceiling for a personal account is 500 recipients/day over SMTP. */
const GMAIL_DAILY_CEILING = 500;
/** Consecutive failures that almost certainly mean a throttle, not a bad address. */
const ABORT_AFTER_CONSECUTIVE_FAILURES = 5;

type Candidate = Recipient & { id: number };

async function candidates(kind: Kind, limit: number, only?: string): Promise<Candidate[]> {
  // A reminder only goes to people who were actually invited and still haven't
  // answered; an invite goes to anyone not yet successfully invited.
  const extra =
    kind === "reminder"
      ? `AND p.status = 'pending'
         AND p.token_expires_at > now()
         AND EXISTS (SELECT 1 FROM email_sends s
                      WHERE s.participant_id = p.id AND s.kind = 'invite' AND s.status = 'sent')`
      : "";

  return (
    await pool.query<Candidate>(
      `SELECT p.id, p.name, p.email, p.token, p.token_expires_at
         FROM participants p
        WHERE NOT EXISTS (SELECT 1 FROM email_sends s
                           WHERE s.participant_id = p.id AND s.kind = $1 AND s.status = 'sent')
          ${extra}
          AND ($3 = '' OR p.email = $3)
        ORDER BY p.registered_at ASC NULLS LAST, p.id ASC
        LIMIT $2`,
      [kind, limit, (only || "").toLowerCase()],
    )
  ).rows;
}

async function run() {
  const kind = (arg("kind") || "invite") as Kind;
  if (kind !== "invite" && kind !== "reminder") {
    console.error(c.red(`--kind must be "invite" or "reminder"`));
    process.exit(1);
  }

  const only = arg("only");
  const dryRun = flag("dry-run");
  const autoYes = flag("yes");
  const rateMs = Number(arg("rate-ms") || env.rateMs);
  const limit = Number(arg("limit") || (only ? 1 : 10_000));
  const baseUrl = env.baseUrl;

  const queue = await candidates(kind, limit, only);

  console.log(`\n${c.bold("Kind")}       ${kind}`);
  console.log(`${c.bold("Base URL")}   ${baseUrl}`);
  console.log(`${c.bold("To send")}    ${c.green(String(queue.length))}${only ? c.dim(` (--only ${only})`) : ""}`);
  console.log(`${c.bold("Throttle")}   ${rateMs}ms between sends`);

  if (queue.length === 0) {
    console.log(c.cyan("\nNothing to send — everyone in scope already has a successful send.\n"));
    await pool.end();
    return;
  }

  const minutes = Math.round((queue.length * rateMs) / 60_000);
  console.log(`${c.bold("Duration")}   ~${minutes} minute${minutes === 1 ? "" : "s"}\n`);

  if (dryRun) {
    const sample = buildEmail(queue[0], kind, baseUrl);
    console.log(c.bold("--- sample email -------------------------------------------"));
    console.log(`To:      ${queue[0].name ? `${queue[0].name} <${queue[0].email}>` : queue[0].email}`);
    console.log(`From:    ${env.fromName} <${env.smtpUser}>`);
    console.log(`Subject: ${sample.subject}\n`);
    console.log(sample.text);
    console.log(c.bold("------------------------------------------------------------"));
    console.log(c.cyan("\n--dry-run: nothing was sent.\n"));
    await pool.end();
    return;
  }

  if (queue.length > GMAIL_DAILY_CEILING) {
    console.log(
      c.yellow(
        `⚠ ${queue.length} messages exceeds Gmail's ${GMAIL_DAILY_CEILING}/day limit for a personal\n` +
          `  account. Run with --limit 400 today and again tomorrow; the queue resumes automatically.\n`,
      ),
    );
  }

  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: { user: env.smtpUser, pass: env.smtpPassword },
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
  });

  process.stdout.write("Verifying SMTP credentials… ");
  await transporter.verify();
  console.log(c.green("ok"));

  if (!autoYes) {
    const ok = await confirm(`\nSend ${queue.length} ${kind} email(s) from ${env.smtpUser}?`);
    if (!ok) {
      console.log("Aborted.");
      transporter.close();
      await pool.end();
      return;
    }
  }

  let sent = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let stopping = false;

  // Ctrl-C finishes the in-flight message rather than killing it mid-SMTP.
  process.on("SIGINT", () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(c.yellow("\n\nStopping after the current message… (Ctrl-C again to force quit)"));
  });

  const started = Date.now();

  for (const [i, person] of queue.entries()) {
    if (stopping) break;

    const { subject, text, html } = buildEmail(person, kind, baseUrl);
    const position = `[${String(i + 1).padStart(String(queue.length).length)}/${queue.length}]`;

    try {
      const info = await transporter.sendMail({
        from: `"${env.fromName}" <${env.smtpUser}>`,
        to: person.name ? `"${person.name.replace(/"/g, "")}" <${person.email}>` : person.email,
        replyTo: env.replyTo || undefined,
        subject,
        text,
        html,
        headers: {
          // Gives Gmail/Outlook a native unsubscribe affordance, which meaningfully
          // improves bulk-send reputation.
          "List-Unsubscribe": `<mailto:${env.replyTo || env.smtpUser}?subject=Unsubscribe>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          "X-Entity-Ref-ID": `${EVENT.lumaId}-${kind}-${person.id}`,
        },
      });

      await pool.query(
        `INSERT INTO email_sends (participant_id, kind, status, message_id)
         VALUES ($1, $2, 'sent', $3)
         ON CONFLICT DO NOTHING`,
        [person.id, kind, info.messageId || null],
      );

      sent++;
      consecutiveFailures = 0;
      console.log(`${c.dim(position)} ${c.green("✓")} ${person.email}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await pool.query(
        `INSERT INTO email_sends (participant_id, kind, status, error) VALUES ($1, $2, 'failed', $3)`,
        [person.id, kind, message.slice(0, 1000)],
      );

      failed++;
      consecutiveFailures++;
      console.log(`${c.dim(position)} ${c.red("✗")} ${person.email} ${c.dim(message.slice(0, 120))}`);

      if (consecutiveFailures >= ABORT_AFTER_CONSECUTIVE_FAILURES) {
        console.log(
          c.red(
            `\n${consecutiveFailures} failures in a row — this looks like a Gmail throttle or a\n` +
              `credential problem rather than bad addresses. Stopping so the account isn't pushed\n` +
              `further. Wait ~24h, then re-run: the queue picks up exactly where it left off.`,
          ),
        );
        break;
      }
    }

    if (i < queue.length - 1 && !stopping) await sleep(rateMs);
  }

  transporter.close();

  const elapsed = Math.round((Date.now() - started) / 1000);
  const remaining = (await candidates(kind, 10_000)).length;

  console.log(`\n${c.bold("Run complete")} in ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`);
  console.log(`  ${c.green(String(sent))} sent   ${failed ? c.red(String(failed)) : "0"} failed`);
  console.log(`  ${remaining > 0 ? c.yellow(String(remaining)) : c.green("0")} still queued for this kind`);
  if (remaining > 0) console.log(c.dim(`  Re-run the same command tomorrow to continue.\n`));
  else console.log("");

  await pool.end();
}

run().catch(async (err) => {
  console.error(c.red(`\n${err.message}`));
  await pool.end().catch(() => {});
  process.exit(1);
});
