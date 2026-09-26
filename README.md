# JS Mumbai #3 — attendance confirmation

Emails every pending registrant a personal link, collects a **coming / not coming**
answer on a landing page, and gives you a CSV to apply in Luma by hand.

The app never writes to Luma. It is the source of truth for the headcount; you stay
in control of what happens on the event page.

- Event: **JS Mumbai #3**, Saturday 26 September 2026, 10:00–15:00 IST, Waterstones Hotel
- Luma: `evt-QHXOdahGbvATs1P` · https://luma.com/jolbsr2c
- ~902 registrations, ~100 real seats

---

## One-time setup

### 1. Database

Provision Postgres (Vercel dashboard → Storage → Neon), copy the connection string, then:

```bash
cp .env.example .env.local     # fill in DATABASE_URL and the rest
psql "$DATABASE_URL" -f lib/schema.sql
```

The schema is safe to re-run — every statement is `IF NOT EXISTS`.

### 2. Gmail App Password

`GMAIL_APP_PASSWORD` is **not** your Gmail password. At
myaccount.google.com → Security, turn on 2-Step Verification, then create an
**App password**. You get 16 characters; paste them into `.env.local` (spaces are fine).

### 3. Deploy

```bash
npx vercel            # link and deploy
```

Set these in the Vercel project settings:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Postgres connection string |
| `NEXT_PUBLIC_BASE_URL` | the deployed origin, no trailing slash |
| `ADMIN_USER` / `ADMIN_PASSWORD` | your dashboard and scanner login |
| `COUNT_SECRET` | path segment for the live count display |

**Do not put the Gmail credentials on Vercel.** The sender runs from your laptop only.

---

## Send day

Timeline assumes a 48h response window plus a reminder. Start by **22 September**
so both send days, the reminder and the deadline all land before the event.

### 1. Import the CSV

```bash
npx tsx scripts/import-csv.ts --file data/guests.csv --dry-run
```

Read the printed column mapping and row counts before continuing. It also prints a
breakdown of any status column, so you can see how many rows are actually pending.

To import only the pending ones:

```bash
npx tsx scripts/import-csv.ts --file data/guests.csv --filter "approval_status=pending_approval"
```

Re-importing a fresher export is safe and additive: existing people keep their token
(so links already in inboxes keep working) and keep any answer they've given.

### 2. Test on yourself

```bash
npx tsx scripts/send-wave.ts --dry-run                  # render, send nothing
npx tsx scripts/send-wave.ts --only you+t1@gmail.com    # one real email
```

Check it lands in **Primary**, not Promotions or Spam, and that the link works.

### 3. Send

Gmail allows **500/day** on a personal account, so ~900 people takes two days:

```bash
npx tsx scripts/send-wave.ts --limit 400      # day 1  (~35 min at 5s spacing)
npx tsx scripts/send-wave.ts --limit 400      # day 2  — picks up where it left off
```

Leave the terminal open. Ctrl-C is safe: it finishes the message in flight and stops.
Re-running never double-sends — a successful send is recorded per person, per kind.

### 4. Reminder, ~36h later

```bash
npx tsx scripts/send-reminders.ts --dry-run
npx tsx scripts/send-reminders.ts --limit 400
```

Only goes to people who were invited, haven't answered, and whose link hasn't expired.

### 5. Watch the numbers

```bash
npx tsx scripts/stats.ts       # terminal snapshot
```

or open `https://<your-app>/admin` and log in.

### 6. Apply to Luma

From the dashboard, download:

- **Coming** → the people to approve in Luma
- **Not coming** + **No response** → the people to decline

Then update the guest list on luma.com by hand.

---

## Door day — check-in and the live count

A second, self-contained flow: volunteers scan each guest's Luma QR, and a screen
shows the headcount live. It shares the database with the RSVP flow above but
nothing else.

**Two things worth knowing before you rely on it.**

Luma's public API cannot record a check-in — `update_guest_status` accepts only
`approved`/`declined`/`pending_approval`/`waitlist`. This app is therefore the only
record of who came, and Luma's own dashboard will keep saying `checked_in: 0` all
day. That is expected, not a bug.

The app holds no Luma credentials. The guest list is pulled once, into
`data/guests.json`, and imported. That file contains 897 guest keys — which are
admission tokens — plus names and emails, so it is gitignored and must stay that way.

### 1. Load the guest list

`data/guests.json` is an array of `{guest_key, luma_guest_id, ticket_id, name, email}`,
pulled from the Luma event. Then:

```bash
npm run db:schema          # adds `attendees` and `check_in_scans`; safe to re-run
npm run import:guests      # upserts into `attendees`
```

Re-importing never clears a check-in, so it is safe to run again on the morning of
the event to pick up late registrations. Add `--prune` to also drop guests who were
declined on Luma since the last pull (anyone already checked in is always kept), and
`--dry-run` to see the +/− counts first. Prune refuses a file much shorter than the
current list, which is what a truncated pull looks like.

### 2. Set COUNT_SECRET

```bash
node -e 'console.log(require("crypto").randomBytes(12).toString("base64url"))'
```

Put it in `.env.local` and in the Vercel project settings. It is the path segment of
the display page, not a password — it only keeps the headcount off a guessable URL.

### 3. At the door

| Surface | Who opens it |
|---|---|
| `/scan` | volunteers, behind the admin username and password |
| `/count/<COUNT_SECRET>` | the display device — no login, share the link freely |

Volunteers open `/scan` in Safari or Chrome, sign in once, and tap **Start scanning**.
The tap matters: iOS will not produce the confirmation beep from an audio context
that wasn't created by a user gesture.

- **Green + name** — checked in.
- **Amber** — already checked in, with the original time. The count does not move.
- **Red** — not on the list, or a ticket for a different Luma event.

The camera never stops; it resumes on its own after each scan. Three phones at once
is fine — check-in is idempotent in Postgres, so whoever scans first wins.

**It keeps working without wifi.** The guest list is cached in the page and check-ins
queue on the device, flushing when the connection returns; a badge shows how many are
waiting. One caveat: two devices that are offline *simultaneously* can both admit the
same QR, because neither can see the other's writes. The server sorts it out on flush
(first wins, second is logged as a duplicate) so the count stays correct — the door
just won't have caught it live.

### 4. The count display

`/count/<COUNT_SECRET>` shows the number in seven-segment digits, polling every 2s.

**Rotating the phone will not make it fullscreen by itself.** No browser allows
fullscreen without a tap, and iOS Safari has no Fullscreen API at all. So:

- **iPhone** — open the link, Share → **Add to Home Screen**, then launch it from
  there. That is the only way it truly fills the screen.
- **Android / laptop** — the **Fullscreen** button works directly.

The screen is kept awake while the page is visible, so the display won't sleep
mid-event.

### 5. Afterwards

`/admin` gains a **Door** section: checked in, guest-list size, and rejected scans.
Two CSV downloads there — **Checked in** and **Full guest list** — are what to keep,
since Luma will have no record of any of it.

---

## Troubleshooting

**Sends start failing in a row.** The script stops itself after 5 consecutive failures —
that pattern means a Gmail throttle or a credential problem, not bad addresses. Wait ~24h
and re-run the same command; the queue resumes exactly where it stopped.

**Someone says their link doesn't work.** Look them up in the dashboard search. If their
link expired, extend it:

```sql
UPDATE participants SET token_expires_at = now() + interval '24 hours'
 WHERE email = 'them@example.com';
```

**Someone wants to change their answer.** They can, themselves, until their link expires —
the page offers it. Or set `status` directly in SQL; `response_events` keeps the history
either way.

**You need to re-send to one person.** Delete their send record and re-run:

```sql
DELETE FROM email_sends WHERE participant_id = <id> AND kind = 'invite';
```

**Moving off Gmail.** Set `SMTP_HOST` / `SMTP_PORT` / `GMAIL_USER` / `GMAIL_APP_PASSWORD`
to any other provider (Resend, SES). No code changes.

---

## Local development

```bash
npm run dev
```

Point `DATABASE_URL` at a local database, apply the schema, import a CSV, then open
any participant's link:

```bash
psql "$DATABASE_URL" -tAc "SELECT 'http://localhost:3000/r/'||token FROM participants LIMIT 1"
```

## How it's put together

| Path | What it does |
|---|---|
| `app/r/[token]/page.tsx` | the landing page: pending / answered / expired / unknown |
| `app/r/[token]/actions.ts` | records the answer, then redirects (Post/Redirect/Get) |
| `app/admin/page.tsx` | counts, search, CSV download buttons |
| `app/api/admin/export/route.ts` | CSV generation |
| `proxy.ts` | HTTP Basic auth over `/admin` and `/api/admin` |
| `app/scan/` | the scanner: camera, decode loop, offline queue |
| `app/count/[secret]/` | the live headcount in seven-segment digits |
| `app/api/scan/` | `manifest` (offline cache) and `checkin` (batched, idempotent) |
| `lib/qr.ts` | parses and validates the Luma check-in QR |
| `lib/checkin.ts` | the idempotent check-in query |
| `lib/schema.sql` | `participants`, `email_sends`, `response_events`, `attendees`, `check_in_scans` |
| `scripts/` | import, send, remind, stats |

Two design points worth keeping if you edit this:

- **The Yes/No buttons are form POSTs, never links.** Corporate link-scanners and inbox
  prefetchers issue GETs; if a GET could confirm attendance, your headcount would be
  fiction. A GET here only ever renders.
- **The action ends in a redirect.** Without it the browser sits on the POST response,
  and a refresh re-submits the form — which would silently flip the person's answer,
  because the answered page offers the opposite choice.
