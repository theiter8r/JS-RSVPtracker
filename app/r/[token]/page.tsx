import { query } from "@/lib/db";
import type { ParticipantStatus } from "@/lib/db";
import { EVENT } from "@/lib/event";
import { respond } from "./actions";

export const dynamic = "force-dynamic";

type Row = {
  name: string | null;
  email: string;
  status: ParticipantStatus;
  token_expires_at: Date;
};

function firstName(name: string | null): string | null {
  const n = (name || "").trim();
  if (!n) return null;
  return n.split(/\s+/)[0];
}

function deadlineLabel(d: Date): string {
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="wrap">
      <div className="card">{children}</div>
    </main>
  );
}

function EventDetails() {
  return (
    <dl className="details">
      <div className="row">
        <dt>When</dt>
        <dd>
          {EVENT.dateLabel}
          <br />
          {EVENT.timeLabel}
        </dd>
      </div>
      <div className="row">
        <dt>Where</dt>
        <dd>
          <a href={EVENT.mapsUrl} target="_blank" rel="noreferrer">
            {EVENT.venueName}
          </a>
          <br />
          <span className="muted">{EVENT.venueAddress}</span>
        </dd>
      </div>
    </dl>
  );
}

export default async function ResponsePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const rows = await query<Row>(
    `SELECT name, email, status, token_expires_at FROM participants WHERE token = $1`,
    [token],
  );

  // Unknown token: stay vague. Never reveal whether a token ever existed.
  if (rows.length === 0) {
    return (
      <Shell>
        <span className="badge">{EVENT.name}</span>
        <h1>This link isn&apos;t recognised</h1>
        <p className="muted">
          The link may have been copied incompletely — try clicking it directly from the email
          rather than pasting it. If it still doesn&apos;t work, reply to the invitation email and
          we&apos;ll sort it out.
        </p>
      </Shell>
    );
  }

  const p = rows[0];
  const expired = new Date(p.token_expires_at).getTime() < Date.now();
  const greeting = firstName(p.name);

  if (expired && p.status === "pending") {
    return (
      <Shell>
        <span className="badge">{EVENT.name}</span>
        <h1>The confirmation window has closed</h1>
        <p>
          We needed responses by <strong>{deadlineLabel(p.token_expires_at)}</strong>, and seats
          have now been allocated to people who confirmed.
        </p>
        <EventDetails />
        <p className="muted">
          If you&apos;d still like to attend, reply to the invitation email — we&apos;ll add you to
          the waiting list in case of drop-outs.
        </p>
      </Shell>
    );
  }

  // Already answered — show it back, and allow a change until the deadline.
  if (p.status !== "pending") {
    const coming = p.status === "yes";
    const flipTo = coming ? "no" : "yes";
    return (
      <Shell>
        <span className="badge">{EVENT.name}</span>
        <div className={`result ${p.status}`} style={{ marginTop: 18 }}>
          <strong>
            {coming
              ? `You're on the list${greeting ? `, ${greeting}` : ""} 🎉`
              : `Thanks for letting us know${greeting ? `, ${greeting}` : ""}`}
          </strong>
          <span className="sub">
            {coming
              ? "We've recorded that you're coming. See you there!"
              : "We've recorded that you can't make it, and your seat goes to someone on the waiting list."}
          </span>
        </div>

        {coming ? <EventDetails /> : null}

        <p className="muted" style={{ marginBottom: 6 }}>
          Recorded against <strong>{p.email}</strong>.
        </p>

        {expired ? (
          <p className="muted">Responses are now closed, so this can no longer be changed.</p>
        ) : (
          <form action={respond}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="answer" value={flipTo} />
            <button type="submit" className="btn-link">
              {coming ? "Actually, I can't make it" : "Actually, I can make it"}
            </button>
          </form>
        )}
      </Shell>
    );
  }

  // Pending — the ask.
  return (
    <Shell>
      <span className="badge">{EVENT.name}</span>
      <h1>{greeting ? `${greeting}, are you coming?` : "Are you coming?"}</h1>
      <h2>
        We have far more registrations than seats, so we need a firm headcount before confirming
        spots.
      </h2>

      <EventDetails />

      <div className="actions">
        <form action={respond}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="answer" value="yes" />
          <button type="submit" className="btn-yes">
            Yes, I&apos;ll be there
          </button>
        </form>
        <form action={respond}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="answer" value="no" />
          <button type="submit" className="btn-no">
            Sorry, I can&apos;t make it
          </button>
        </form>
      </div>

      <p className="deadline">
        Please answer by <strong>{deadlineLabel(p.token_expires_at)}</strong>.
        <br />
        You can change your answer until then.
      </p>
    </Shell>
  );
}
