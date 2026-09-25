import { query } from "@/lib/db";
import type { ParticipantStatus } from "@/lib/db";
import { EVENT } from "@/lib/event";

export const dynamic = "force-dynamic";

type Stats = {
  total: string;
  yes: string;
  no: string;
  pending: string;
  invited: string;
  reminded: string;
  failed: string;
};

type Door = {
  guests: string;
  checked_in: string;
  turned_away: string;
};

type Row = {
  id: number;
  email: string;
  name: string | null;
  status: ParticipantStatus;
  responded_at: Date | null;
  invited_at: Date | null;
  send_failed: boolean;
};

const PAGE_SIZE = 200;

function fmt(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(new Date(d));
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q || "").trim();
  const status = ["yes", "no", "pending"].includes(sp.status || "") ? sp.status! : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const [stats] = await query<Stats>(`
    SELECT
      count(*)                                            AS total,
      count(*) FILTER (WHERE status = 'yes')              AS yes,
      count(*) FILTER (WHERE status = 'no')               AS no,
      count(*) FILTER (WHERE status = 'pending')          AS pending,
      (SELECT count(DISTINCT participant_id) FROM email_sends
        WHERE kind = 'invite'   AND status = 'sent')      AS invited,
      (SELECT count(DISTINCT participant_id) FROM email_sends
        WHERE kind = 'reminder' AND status = 'sent')      AS reminded,
      (SELECT count(DISTINCT participant_id) FROM email_sends e
        WHERE e.status = 'failed'
          AND NOT EXISTS (SELECT 1 FROM email_sends s
                           WHERE s.participant_id = e.participant_id
                             AND s.kind = e.kind AND s.status = 'sent')) AS failed
    FROM participants
  `);

  // The door is a separate concern from the email RSVP above: different table,
  // different question. Kept as its own query rather than bolted onto that one.
  const [door] = await query<Door>(`
    SELECT count(*)                                          AS guests,
           count(*) FILTER (WHERE checked_in_at IS NOT NULL) AS checked_in,
           (SELECT count(*) FROM check_in_scans
             WHERE outcome IN ('unknown', 'foreign'))        AS turned_away
      FROM attendees
  `);

  const rows = await query<Row>(
    `SELECT p.id, p.email, p.name, p.status, p.responded_at,
            (SELECT max(sent_at) FROM email_sends e
              WHERE e.participant_id = p.id AND e.status = 'sent') AS invited_at,
            EXISTS (SELECT 1 FROM email_sends e
                     WHERE e.participant_id = p.id AND e.status = 'failed'
                       AND NOT EXISTS (SELECT 1 FROM email_sends s
                                        WHERE s.participant_id = p.id
                                          AND s.kind = e.kind AND s.status = 'sent')) AS send_failed
       FROM participants p
      WHERE ($1 = '' OR p.email ILIKE '%' || $1 || '%' OR coalesce(p.name, '') ILIKE '%' || $1 || '%')
        AND ($2 = '' OR p.status = $2)
      ORDER BY p.responded_at DESC NULLS LAST, p.id ASC
      LIMIT $3 OFFSET $4`,
    [q, status, PAGE_SIZE, (page - 1) * PAGE_SIZE],
  );

  const total = Number(stats?.total || 0);
  const yes = Number(stats?.yes || 0);
  const no = Number(stats?.no || 0);
  const pending = Number(stats?.pending || 0);
  const invited = Number(stats?.invited || 0);
  const answered = yes + no;
  const responseRate = invited > 0 ? Math.round((answered / invited) * 100) : 0;
  const exportQs = status ? `&status=${status}` : "";

  const guests = Number(door?.guests || 0);
  const checkedIn = Number(door?.checked_in || 0);
  const turnedAway = Number(door?.turned_away || 0);

  return (
    <main className="admin-wrap">
      <span className="badge">{EVENT.name}</span>
      <h1 style={{ marginBottom: 4 }}>Attendance dashboard</h1>
      <p className="muted">
        {EVENT.dateLabel} · {EVENT.venueName}
      </p>

      <h2 style={{ margin: "20px 0 8px", fontSize: "1rem" }}>Door</h2>
      <div className="stats">
        <div className="stat yes">
          <div className="k">Checked in</div>
          <div className="v">{checkedIn.toLocaleString("en-IN")}</div>
        </div>
        <div className="stat">
          <div className="k">On the guest list</div>
          <div className="v">{guests.toLocaleString("en-IN")}</div>
        </div>
        <div className="stat">
          <div className="k">Rejected scans</div>
          <div className="v">{turnedAway.toLocaleString("en-IN")}</div>
        </div>
      </div>

      <div className="toolbar">
        <a className="dl primary" href="/api/admin/export?kind=checked_in">
          ↓ Checked in ({checkedIn})
        </a>
        <a className="dl" href="/api/admin/export?kind=attendees">
          ↓ Full guest list ({guests})
        </a>
      </div>

      <h2 style={{ margin: "28px 0 8px", fontSize: "1rem" }}>Email RSVP</h2>
      <div className="stats">
        <div className="stat">
          <div className="k">Participants</div>
          <div className="v">{total.toLocaleString("en-IN")}</div>
        </div>
        <div className="stat">
          <div className="k">Emailed</div>
          <div className="v">{invited.toLocaleString("en-IN")}</div>
        </div>
        <div className="stat yes">
          <div className="k">Coming</div>
          <div className="v">{yes.toLocaleString("en-IN")}</div>
        </div>
        <div className="stat no">
          <div className="k">Not coming</div>
          <div className="v">{no.toLocaleString("en-IN")}</div>
        </div>
        <div className="stat">
          <div className="k">No response</div>
          <div className="v">{pending.toLocaleString("en-IN")}</div>
        </div>
        <div className="stat">
          <div className="k">Response rate</div>
          <div className="v">{responseRate}%</div>
        </div>
      </div>

      <div className="bar" title={`${yes} coming / ${no} not coming / ${pending} no response`}>
        <i className="s-yes" style={{ width: `${total ? (yes / total) * 100 : 0}%` }} />
        <i className="s-no" style={{ width: `${total ? (no / total) * 100 : 0}%` }} />
      </div>

      <p className="muted" style={{ marginTop: -12 }}>
        {Number(stats?.reminded || 0).toLocaleString("en-IN")} reminders sent ·{" "}
        {Number(stats?.failed || 0).toLocaleString("en-IN")} unresolved send failures
      </p>

      <div className="toolbar">
        <form method="GET" style={{ display: "flex", gap: 8 }}>
          <input type="search" name="q" placeholder="Search name or email" defaultValue={q} />
          <select name="status" defaultValue={status}>
            <option value="">All statuses</option>
            <option value="yes">Coming</option>
            <option value="no">Not coming</option>
            <option value="pending">No response</option>
          </select>
          <button type="submit" style={{ width: "auto", padding: "9px 16px" }}>
            Filter
          </button>
        </form>
      </div>

      <div className="toolbar">
        <a className="dl primary" href="/api/admin/export?status=yes">
          ↓ Coming ({yes})
        </a>
        <a className="dl" href="/api/admin/export?status=no">
          ↓ Not coming ({no})
        </a>
        <a className="dl" href="/api/admin/export?status=pending">
          ↓ No response ({pending})
        </a>
        <a className="dl" href="/api/admin/export?status=all">
          ↓ Everything ({total})
        </a>
        <a className="dl" href={`/api/admin/export?status=all&full=1${exportQs}`}>
          ↓ Full export (all CSV columns)
        </a>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Name</th>
              <th>Email</th>
              <th>Responded</th>
              <th>Emailed</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ color: "var(--muted)" }}>
                  No participants match this filter.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className={`pill ${r.status}`}>
                      {r.status === "yes" ? "Coming" : r.status === "no" ? "Not coming" : "—"}
                    </span>
                  </td>
                  <td>{r.name || "—"}</td>
                  <td className="email">{r.email}</td>
                  <td>{fmt(r.responded_at)}</td>
                  <td>
                    {r.send_failed ? (
                      <span style={{ color: "var(--no)" }}>failed</span>
                    ) : (
                      fmt(r.invited_at)
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="toolbar" style={{ marginTop: 14 }}>
        {page > 1 ? (
          <a className="dl" href={`/admin?q=${encodeURIComponent(q)}&status=${status}&page=${page - 1}`}>
            ← Previous
          </a>
        ) : null}
        {rows.length === PAGE_SIZE ? (
          <a className="dl" href={`/admin?q=${encodeURIComponent(q)}&status=${status}&page=${page + 1}`}>
            Next →
          </a>
        ) : null}
        <span className="muted">
          Showing {rows.length.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
        </span>
      </div>
    </main>
  );
}
