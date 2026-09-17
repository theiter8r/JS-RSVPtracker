import { EVENT } from "../lib/event";

export type Kind = "invite" | "reminder";

export type Recipient = {
  name: string | null;
  email: string;
  token: string;
  token_expires_at: Date;
};

function firstName(name: string | null): string {
  const n = (name || "").trim();
  if (!n) return "";
  // Titles and all-caps handles read badly in a greeting; take a plain first word.
  return n.split(/\s+/)[0].replace(/[^\p{L}\p{N}'-]/gu, "");
}

function deadline(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date(d));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );
}

export function buildEmail(r: Recipient, kind: Kind, baseUrl: string) {
  const fn = firstName(r.name);
  const hello = fn ? `Hi ${fn},` : "Hi,";
  const link = `${baseUrl}/r/${r.token}`;
  const by = deadline(r.token_expires_at);

  const subject =
    kind === "invite"
      ? fn
        ? `${fn}, are you coming to ${EVENT.name}?`
        : `Are you coming to ${EVENT.name}?`
      : `Reminder: confirm your seat for ${EVENT.name}`;

  const opener =
    kind === "invite"
      ? `You registered for ${EVENT.name}, and we're thrilled you want to come. We had over 900 registrations for a room that seats about 100 — so before we confirm spots, we need to know who can genuinely make it.`
      : `A quick nudge: we still haven't heard back from you about ${EVENT.name}. Seats are being allocated to people who confirm, so please take a few seconds to answer.`;

  const text = [
    hello,
    "",
    opener,
    "",
    "It takes one click:",
    link,
    "",
    `${EVENT.name}`,
    `${EVENT.dateLabel}, ${EVENT.timeLabel}`,
    `${EVENT.venueName} — ${EVENT.venueAddress}`,
    "",
    `Please answer by ${by}. If we don't hear from you, your spot goes to someone on the waiting list.`,
    "",
    "Either answer is genuinely helpful — telling us you can't make it frees a seat for someone who can.",
    "",
    "See you there,",
    "The JS Mumbai team",
    "",
    `If the link doesn't work, copy and paste it into your browser: ${link}`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px 12px;background:#f6f6f4;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#16161a;line-height:1.55;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e0;border-radius:14px;">
    <tr><td style="padding:28px 26px;">

      <div style="display:inline-block;background:#f7df1e;color:#16161a;font-weight:700;font-size:12px;letter-spacing:.06em;text-transform:uppercase;padding:5px 10px;border-radius:6px;">${escapeHtml(EVENT.name)}</div>

      <h1 style="font-size:23px;line-height:1.3;margin:18px 0 14px;letter-spacing:-.02em;">${escapeHtml(
        kind === "invite" ? (fn ? `${fn}, are you coming?` : "Are you coming?") : "Still coming?",
      )}</h1>

      <p style="margin:0 0 14px;">${escapeHtml(hello)}</p>
      <p style="margin:0 0 20px;">${escapeHtml(opener)}</p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td align="center" style="padding:4px 0 18px;">
          <a href="${link}" style="display:inline-block;background:#f7df1e;color:#16161a;font-weight:700;font-size:16px;text-decoration:none;padding:14px 30px;border-radius:10px;">Confirm in one click</a>
        </td></tr>
      </table>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #e4e4e0;border-bottom:1px solid #e4e4e0;margin:4px 0 18px;">
        <tr>
          <td style="padding:14px 0 4px;color:#6b6b76;font-size:13px;width:70px;">When</td>
          <td style="padding:14px 0 4px;font-size:15px;">${escapeHtml(EVENT.dateLabel)}<br>${escapeHtml(EVENT.timeLabel)}</td>
        </tr>
        <tr>
          <td style="padding:4px 0 14px;color:#6b6b76;font-size:13px;">Where</td>
          <td style="padding:4px 0 14px;font-size:15px;"><a href="${EVENT.mapsUrl}" style="color:#16161a;">${escapeHtml(EVENT.venueName)}</a><br><span style="color:#6b6b76;">${escapeHtml(EVENT.venueAddress)}</span></td>
        </tr>
      </table>

      <p style="margin:0 0 14px;">Please answer by <strong>${escapeHtml(by)}</strong>. If we don&rsquo;t hear from you, your spot goes to someone on the waiting list.</p>
      <p style="margin:0 0 22px;color:#6b6b76;font-size:14px;">Either answer genuinely helps &mdash; telling us you can&rsquo;t make it frees a seat for someone who can.</p>

      <p style="margin:0 0 4px;">See you there,<br>The JS Mumbai team</p>

      <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #e4e4e0;color:#9a9aa5;font-size:12px;line-height:1.5;">
        You&rsquo;re getting this because you registered for ${escapeHtml(EVENT.name)} on Luma with ${escapeHtml(r.email)}.<br>
        If the button doesn&rsquo;t work, paste this into your browser:<br>
        <span style="word-break:break-all;color:#6b6b76;">${link}</span>
      </p>

    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
