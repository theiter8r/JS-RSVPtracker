/**
 * Validated environment access. Every getter throws a readable error at the point
 * of use rather than letting `undefined` leak into a query string or an SMTP login.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Add it to .env.local (local scripts) or the Vercel project settings (deployed app).`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  /** Public origin of the deployed app, e.g. https://rsvp.jsmumbai.dev — no trailing slash. */
  get baseUrl() {
    return required("NEXT_PUBLIC_BASE_URL").replace(/\/+$/, "");
  },
  get adminUser() {
    return required("ADMIN_USER");
  },
  get adminPassword() {
    return required("ADMIN_PASSWORD");
  },
  /**
   * The unguessable path segment for the live count display, e.g. /count/<secret>.
   * Not a password: it keeps the number off a lucky URL guess, nothing more.
   */
  get countSecret() {
    return required("COUNT_SECRET");
  },

  // --- sender only (local scripts; never set on Vercel) ---
  get smtpHost() {
    return optional("SMTP_HOST", "smtp.gmail.com");
  },
  get smtpPort() {
    return Number(optional("SMTP_PORT", "465"));
  },
  get smtpUser() {
    return required("GMAIL_USER");
  },
  /** A 16-character Google App Password, NOT the account password. Requires 2FA. */
  get smtpPassword() {
    return required("GMAIL_APP_PASSWORD").replace(/\s+/g, "");
  },
  get fromName() {
    return optional("MAIL_FROM_NAME", "JS Mumbai");
  },
  get replyTo() {
    return optional("MAIL_REPLY_TO", process.env.GMAIL_USER || "");
  },
  /** Milliseconds to wait between sends. 5000 ≈ 12/min, gentle enough for Gmail. */
  get rateMs() {
    return Number(optional("RATE_MS", "5000"));
  },
} as const;
