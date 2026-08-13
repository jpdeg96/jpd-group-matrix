# JPD Group Matrix

Internal event workflow system.

Events live on the **Event Dashboard**. Ticking **Complete** promotes an event
into **C1 staging**, where it works through a configurable series of review
checkpoints — D-21, D-14, D-7, D-5, D-1 by default. In C1 an event is a single
row showing only its *current* checkpoint; ticking Done advances it to the next
one. When every checkpoint is resolved the event leaves C1.

---

## Contents

- [Timezone](#timezone)
- [Requirements](#requirements) · [Install](#install) · [Environment](#environment-variables)
- [Database](#database) · [Seed data](#seed-data) · [Run locally](#run-locally) · [Tests](#tests)
- [The tabs](#the-tabs)
- [Features](#features)
- [Authentication and roles](#authentication-and-roles)
- [Architecture](#architecture)
- [Deployment](#deployment)
- [Verification status](#verification-status)

---

## Timezone

**Every business-date decision is made in the timezone configured in Settings**,
which defaults to `America/Caracas` (Venezuela Time, a fixed UTC-4 with no
daylight saving). Not UTC, not the server's locale, not the browser's.

| Concern | Implementation |
|---|---|
| Calendar dates | `event_date` and `review_due` are Postgres `DATE`. In code they are `PlainDate` — an ISO `YYYY-MM-DD` string ([`lib/date/plain-date.ts`](lib/date/plain-date.ts)). Never a `Date`, so a UTC conversion cannot shift the day. |
| "Today" | `businessToday()` in [`lib/services/settings.ts`](lib/services/settings.ts), which asks `Intl` for the date in the configured zone. The only wall-clock read in the domain. |
| Offsets | The zone is always referenced by IANA name. **No UTC offset is hard-coded anywhere** — Venezuela ran UTC-4:30 from 2007 to 2016, and resolving through the IANA database means historical dates stay correct. |
| Instants | Completion and archival timestamps are real `TIMESTAMPTZ`, stored UTC, rendered in the business zone. |

Tests run with `TZ=Pacific/Kiritimati` (UTC+14) so any accidental dependency on
the host timezone fails loudly.

---

## Requirements

- **Node.js 20.11+** (verified on 24.19)
- **PostgreSQL 14+** (verified on 17.10)

## Install

```bash
npm install
```

## Environment variables

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. |
| `DIRECT_URL` | yes | Connection used for migrations. Prisma refuses to load a schema referencing a missing variable, so this must always be set. On Neon/Supabase use the direct endpoint; locally just repeat `DATABASE_URL`. |
| `TEST_DATABASE_URL` | no | Scratch database for `npm run test:integration`, which **truncates tables**. Never point it at your working database. |
| `AUTH_SECRET` | yes | Signs the session JWT. `openssl rand -base64 32`. |
| `AUTH_URL` | prod | Canonical deployment URL. |
| `AUTH_TRUST_HOST` | prod | `true` behind a proxy or on Vercel. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | no | Enables Google sign-in. |
| `AUTH_GOOGLE_WORKSPACE_DOMAIN` | no | Restricts Google sign-in to one Workspace domain, e.g. `jpdgroup.com`. |
| `CRON_SECRET` | yes | Bearer token protecting the maintenance endpoint. `openssl rand -hex 32`. |
| `CLOCKIFY_API_KEY` | no | Enables the time widget. Deliberately an env var, not a Settings field, so a database dump never carries a live credential. |
| `SEED_PASSWORD` | no | Password for seeded demo users. Default `phantom1234`. |

---

## Database

```bash
docker compose up -d      # or point DATABASE_URL at any Postgres
npm run db:deploy
```

`db:deploy` applies committed migrations — what production uses. While changing
the schema locally use `npm run db:migrate`.

The second migration installs constraints Prisma's schema language cannot
express: stage completion coherence, settings singleton, lowercase emails,
`#rrggbb` colours, non-blank notes. **These are not decorative** — the
completion-coherence check caught a real ordering bug during development.

## Seed data

```bash
npm run db:seed
```

**Destructive.** Refuses to run against `NODE_ENV=production` unless
`ALLOW_PRODUCTION_SEED=1`. Builds 6 users (admin / manager / users / one
deactivated), 6 event types, 6 dashboard events, 4 C1 events at different
stages, one fully completed event, and multi-author notes.

Sign in as `admin@jpdgroup.test` / `phantom1234`.

## Run locally

```bash
npm run dev          # development
npm run build && npm start   # production build
npm run typecheck
npm run maintenance  # one-off housekeeping pass
```

## Tests

```bash
npm test                  # 86 pure tests, no database needed
npm run test:integration  # 26 database-backed tests
npm run test:all
```

Two suites with separate configs, so `npm test` works on a machine with no
Postgres and never fails for reasons unrelated to the business rules.

**Unit** — weekend adjustment across a full year, stage advance, offset
normalisation, calendar/DST edge cases, the Postgres `DATE` round trip,
spreadsheet parsing (quoted commas, ambiguous slash dates, duplicate detection),
marketplace URL construction, Clockify duration parsing, the Today/This
week/Next week ranges, and rejection of invalid dates.

**Integration** — promotion via Complete, SKIPPED vs PENDING stages, idempotency,
stage advance and re-opening, the undo guard, delete-cascades-to-C1,
cancel-when-history-exists, checkbox semantics, the full assignment matrix
(claim / release own / blocked from taking another's), detail-editing
restricted to managers, flag raise and clear permissions, concurrent field
updates, note attribution, and the database constraints.

---

## The tabs

Four are visible to everyone signed in — Event Dashboard, C1, Users, Settings.
**Metrics** and **Audit** appear only for managers and administrators.

**Event Dashboard** — Date, Type (with emoji), Away Team / Artist, Home Team,
Venue, marketplace links, In progress, Assigned, Flag, Complete, SeatGeek,
TicketData, Notes, Audited. Sortable on every text column, and **every column is
drag-resizable** (widths saved per browser, since a laptop and a wide monitor
want different layouts).

Ticking **Complete** sends the event to C1 but **keeps it on the dashboard** as
the permanent record. Three scope chips control what is shown:

| Chip | Shows |
|---|---|
| **Open** (default) | Work not yet sent to C1 |
| **Completed** | Events already promoted, dimmed and badged "In C1" |
| **Stale 30d+** | Completed more than 30 days ago and still sitting there |

Staleness is measured from the **Complete timestamp** specifically, so a stray
note or reassignment does not reset the clock on something that has genuinely
been parked for six weeks. Each completed row shows its age inline (`34d ago ⚠`).

Every check and uncheck of Complete is recorded, and a **history** link on the
cell shows who ticked it, who unticked it, and when — read from the audit log
rather than a parallel table, so there is only ever one version of that truth.

Base users do not see the **Audited** or **Actions** columns, or the "to audit"
counter. The server enforces the same restriction independently.

Every timestamp carries a colored dot identifying who ticked it — the same
identity color used in dropdowns and assignments, so a column of checkboxes can
be read at a glance. The name is always in the tooltip; color is never the only
cue.

**C1** — Review Due (editable), Stage, Date, Type, teams, Venue, marketplace
links, In progress, Assigned, Flag, Done. One row per event, showing only its
current checkpoint. **Today / This week / Next week** shortcut chips sit above
the filters, each with a live count.

Overdue rows are **hidden** in C1. A stage only moves when somebody ticks Done,
so a passed review date is an ordinary state rather than an alarm. They are not
deleted or archived — the header reports how many are hidden, so the work is
never silently lost, and the count links the two facts together.

Managers can select rows and **bulk-edit review dates**, either setting them all
to one date or shifting them by N days (which preserves the spacing between
stages). Resolved stages are skipped rather than rewritten.

**Users** — roles, colors, activation, Clockify linking, and whether a person is
excluded from the weekly hours report.

**Metrics** — per-person completion counts, the split by event type, C1 stages
done, hours worked this week, and completions per day. Manager and above.

**Settings** — site name, timezone, review stages, weekend rule, presence
timeout, default theme, marketplace links, the event type list, and Clockify.

> There is no Archive tab. Completed stage history is **retained in full**
> (`review_stages` keeps status, owner and completion instant per checkpoint) and
> is queryable for productivity reporting — it simply has no browsable screen.
> `getEventStageHistory()` in [`lib/services/stages.ts`](lib/services/stages.ts)
> is the entry point.

---

## Features

**In progress (live).** Mark yourself as working on an event and everyone sees
it in real time — a glowing row and a pulsing dot. Server-Sent Events with a
polling fallback, so it works on any host. Presence is **heartbeat-expired**:
without that, one closed laptop leaves an event flagged forever and within a
week nobody trusts the indicator.

**Bulk import.** Paste straight from Excel or Google Sheets (the clipboard is
already tab-separated) or load a CSV. Parsing is two-phase: a preview table
shows per-row errors, ambiguous dates, new types and duplicate rows **before
anything is written**. No `.xlsx` parser is bundled — SheetJS's npm builds have
carried known advisories, and "paste, or Save As CSV" covers the same ground
without that exposure.

**Marketplace links.** SeatGeek and StubHub search URLs built from the event's
own teams and venue, shown on both the Dashboard and C1. No API key, nothing to
expire, works the moment an event is typed. Both URL formats are verified
against the live sites and pinned by a regression test — StubHub's older
`/find/s/?q=` form now 404s, so the app uses `/search?q=`. They land on a results
page rather than the exact event; exact-event links would need each
marketplace's API (SeatGeek has historically had self-serve access, StubHub's is
partner-gated) and are deliberately left as a documented extension rather than
half-built.

**Flag for review.** Anyone can raise a flag on an event, with an optional
reason; only a manager or administrator can clear it. The asymmetry is the
point — the person who spots a problem is often not the person permitted to fix
it, and a flag its own cause can dismiss is not a flag. Flagged counts appear in
both headers, and C1 has a Flagged filter chip.

**Audit log.** A manager-and-above screen over every recorded change: who,
when, what, and the before/after values. Filterable by person, entity and
action, paginated by cursor, exportable to CSV. Actions taken while viewing as
somebody else show both names, so "who really did this" is never lost.

**Clockify time tracking (optional).** A header chip shows the running timer,
today's and this week's totals, and who else is clocked in.

Two separate values are needed and they are easy to confuse:

| Value | Where it goes | Secret? |
|---|---|---|
| **API key** | `CLOCKIFY_API_KEY` in `.env`, then restart | yes |
| **Workspace ID** | Settings → Clockify | no |

Each person also needs their Clockify user linked under Users. Switched off,
unconfigured, or unreachable, the widget simply does not render — it never
breaks a page.

> **Verified against a live workspace.** Authentication, workspace resolution,
> the member list and the weekly summary have all been exercised end to end
> against a real Clockify account.
>
> The key is read from the environment **once, at process start**. Changing
> `CLOCKIFY_API_KEY` in `.env` without restarting leaves the running server using
> the old value, which presents as Clockify "rejecting" a key that is perfectly
> valid — the 401 message says so explicitly. It is also a *personal* API key: it
> acts as that person across their whole Clockify account, not just this
> workspace. It deliberately never reaches the database or the browser; only
> `clockifyKeyPresent: boolean` is sent client-side.

**User metrics.** A manager-and-above screen answering "who did how much, over
what window". One period filter — Today, Yesterday, This week, Last week, This
month, Last month, Year to date, All time — scopes every chart on the page.

Four things it gets deliberately right:

- **Credit follows the actor, not the assignee.** Counts come from
  `completed_by_user_id` and `done_by_user_id`, so reassigning an event never
  moves work someone else already did.
- **In-progress periods end today**, not at the end of the unit — otherwise the
  per-day average is dragged down by days that have not happened yet.
- **Colour follows the entity, never its rank.** Each event type holds a palette
  slot derived from its `sortOrder`, so filtering to a narrower period does not
  repaint the surviving slices.
- **Every value is reachable without colour.** The legend carries exact counts
  and percentages, and a "Show tables" view renders the same figures as numbers —
  three of the six palette slots sit below 3:1 contrast on a near-white surface.

**Hours worked this week** pulls per-person totals from Clockify (Monday to now,
regardless of the period filter — it reflects the current week by definition).
People with `exclude_from_time_report` set are omitted and named beneath the
chart, so an exclusion is visible rather than silent; unlinked people are left
out entirely rather than shown as zero.

> **No SVG `<title>` in charts.** React treats `<title>` as hoistable document
> metadata *even inside `<svg>`*, and server-renders it empty when it has more
> than a single string child. That mismatches the client and makes React discard
> the entire hydrated tree — the page still looks right, but every event handler
> on it is gone. Chart tooltips are plain HTML for this reason.

**Notes with attribution.** Each note is its own record with author, colour and
timestamp. Editing is restricted to the author or an admin and stamps `editedAt`;
the original text survives in the audit log.

**Themes.** Light, Dark, and Blossom (pink). Each person picks their own from
the header and it is saved to their account, so it follows them between
machines; the site default in Settings applies to anyone who has not chosen.
Applied by an inline script before first paint, so there is no flash of the
wrong theme.

**View as another user.** Admin-only. The target lives in an httpOnly cookie that
is **worthless on its own** — it is honoured only when the real session belongs to
an active administrator, re-checked every request. A permanent, undismissable
banner shows who you are viewing as, and every action records both the
administrator and the account acted upon.

---

## Authentication and roles

Auth.js v5, JWT sessions, 12-hour expiry. Credentials (email + bcrypt) always
enabled; Google OAuth when configured.

**Neither provider self-registers.** An active user row must already exist.
Sign-in failures return one identical message whether the password was wrong, the
account unknown, or deactivated — so the response cannot enumerate accounts.

| | ADMIN | MANAGER | USER |
|---|---|---|---|
| Operational work, notes, checkboxes | ✅ | ✅ | ✅ |
| Claim **unassigned** work / release **own** | ✅ | ✅ | ✅ |
| Take or release work assigned to **someone else** | ✅ | ✅ | — |
| Raise a flag | ✅ | ✅ | ✅ |
| Clear a flag | ✅ | ✅ | — |
| **Add or edit** event details (date, type, teams, venue) | ✅ | ✅ | — |
| Delete / cancel events, bulk import | ✅ | ✅ | — |
| Users, Settings, event types | ✅ | — | — |
| View as another user | ✅ | — | — |

A base user can only ever pick up work nobody holds. To move an assigned event,
either its holder releases it or a manager reassigns on their behalf — the
dropdown greys out the options they cannot choose rather than offering them and
having the server reject the attempt.

`event_id`, `offset_days`, stage `status` and every completion timestamp are
system-controlled; the request schemas drop them before a service sees them.

### Backups

Two layers, because they fail in different ways.

**Render's point-in-time recovery** is automatic on any paid database — 3 days of
retention on a Hobby workspace, 7 on Pro. It covers "somebody broke this at 9am";
it does not cover anything older, or the loss of the Render account itself.

**A daily `pg_dump`** runs from
[`.github/workflows/backup.yml`](.github/workflows/backup.yml) at 07:00 UTC and
uploads the archive as a GitHub artifact kept for 90 days. It needs one repo
secret, `BACKUP_DATABASE_URL`, set to the database's **external** connection
string. Trigger it by hand from the Actions tab to test it.

The job pins `container: postgres:18` to match Render's major version. **`pg_dump`
refuses to dump a server newer than itself**, so that line has to be bumped
whenever Render upgrades — and a stale pin fails at backup time, not at restore
time, which is the good direction to fail in.

It also reads the archive back and asserts that every table is present. A dump
that succeeds but contains nothing reports success and is only discovered to be
empty on the day it matters.

#### Restoring

**Never restore over production.** Restore into a scratch database, look at it,
then decide. Render's one free Postgres is ideal for this — version-matched,
free, and its 30-day expiry is irrelevant for a throwaway.

```bash
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="SCRATCH_DATABASE_URL" matrix-2026-08-11.dump
```

`--no-owner --no-privileges` matter: role names differ between Render and
wherever you restore, and without them the restore fails on grants.

Point a local instance at the scratch database, confirm it holds what you expect,
and only then either swap `DATABASE_URL` or copy the specific rows back. A single
table can be pulled out on its own with `--table=events`.

> Before reaching for a restore, check the **Audit** screen. Every change records
> its before and after values, so reverting one mistaken edit is a lookup and a
> re-edit rather than a database restore. Most "can we go back?" moments are that.

If a connection string carries Prisma's `?schema=public`, strip it — libpq
rejects the whole URL rather than ignoring the unknown parameter. The workflow
does this itself.

### Google Workspace setup

1. Google Cloud Console → **APIs & Services → Credentials → OAuth client ID → Web application**.
2. Authorised redirect URI: `https://your-domain/api/auth/callback/google`.
3. Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and `AUTH_GOOGLE_WORKSPACE_DOMAIN`.
4. Create each person under **Users** first — Google sign-in never creates accounts.

The `hd` parameter is only a UX hint and can be bypassed; enforcement is
server-side against the verified profile *and* the existing-user check.

---

## Architecture

```
UI (React)  →  API route handlers  →  Service layer  →  Prisma / PostgreSQL
                (authorise, validate, delegate)   (transactions, audit)

lib/date/     PlainDate + the business clock        ← pure
lib/domain/   review schedule, import parsing       ← pure
lib/auth/actor.ts   permission rules                ← pure, no next-auth
lib/auth/guards.ts  session resolution              ← next-auth lives here
```

Business logic never lives in a React component, and the domain takes "today" as
an argument rather than reading a clock — which is what makes every rule directly
testable. Permission rules sit in `actor.ts`, deliberately free of next-auth, so
services can be tested without booting the auth stack.

**Concurrency.** Every edit is a partial `PATCH` carrying only the changed field,
written as targeted columns. Nothing ever posts a whole row back, so two people
working the same row cannot overwrite each other. The UI is optimistic and
reconciles against the server; a failed save restores the previous value and
surfaces the error rather than leaving a checkbox looking ticked.

**Data model notes**

- Stage identity is `offset_days`, never `review_due` — weekend adjustment can
  collapse two stages onto one date, and both must survive. Uniqueness is
  `(event_id, offset_days)`.
- A stage past its deadline at promotion is `SKIPPED`, not `PENDING`. It was
  never actionable, and counting it as outstanding would make reporting lie.
- Unticking Complete is an undo for a misclick — it is **refused** once any stage
  has been completed, so work cannot be silently discarded.
- Deleting an event with completion history **cancels** it instead, keeping the
  record.
- Promoting to C1 **does not remove the event from the dashboard**. `status`
  drives which scope chip shows it; the row itself is permanent. Dashboard
  counters deliberately count only `DASHBOARD` rows, so "unassigned" and
  "SeatGeek to do" keep meaning outstanding work rather than all work ever.
- Completion history is derived from `audit_logs` via the dedicated
  `COMPLETE_CHECKED` / `COMPLETE_UNCHECKED` actions. A no-op re-tick writes
  nothing, so the history is a record of change rather than of clicks.
- Changing the stage list in Settings is **not retroactive**. Events already in
  C1 keep their stages and completions.
- Dialogs render through a React portal onto `document.body`. This is not
  cosmetic: `position: fixed` resolves against the nearest ancestor carrying a
  transform or filter, and table rows have a hover `filter: brightness()` — a
  dialog rendered in place gets trapped inside its own row.

### Branding

Drop your logo at **`public/jpd-logo.png`** and it is picked up automatically —
no code change, no rebuild of any config. `.png`, `.jpg` and `.webp` all take
precedence over the built-in `jpd-logo.svg` placeholder, in that order.

Which file exists is resolved on the server, so a missing PNG never produces a
404 in the browser console. The image is sized by height with `width: auto` and
`object-contain`, so any aspect ratio or pixel size fits without distortion —
a wide wordmark and a square mark both work. It appears in the header (26px)
and on the sign-in screen (44px).

---

## Deployment

### Vercel + hosted Postgres

1. Provision Postgres (Neon/Supabase). Set `DATABASE_URL` and `DIRECT_URL`.
2. Import the repo into Vercel; set every variable from the table above.
3. `npm run db:deploy` against production.
4. Deploy. Confirm the hourly cron under **Settings → Cron Jobs**.
5. Create the first administrator directly — there is no public registration.
   Generate a hash with
   `node -e "console.log(require('bcryptjs').hashSync('your-password',12))"`:

```sql
INSERT INTO users (id, email, display_name, password_hash, role, active, color, created_at, updated_at)
VALUES (gen_random_uuid(), 'you@example.com', 'Your Name', '<bcrypt-hash>', 'ADMIN', true, '#2563eb', now(), now());
```

**Note on Vercel:** the Hobby plan prohibits commercial use and caps cron at once
daily — an internal business tool needs **Pro ($20/mo)**. Render is a cheaper
single-vendor alternative at roughly $14/mo.

### Self-hosted

```bash
npm ci && npm run db:deploy && npm run build && npm start
npm run scheduler   # separate process for housekeeping
```

### Maintenance

`runMaintenance()` sweeps expired presence rows and reports slippage
(past-dated dashboard events, overdue C1 stages). It is deliberately read-only
otherwise: nothing auto-archives or auto-completes, so the job surfaces problems
rather than quietly tidying them away. Idempotent, safe to run hourly.

`POST`/`GET /api/internal/maintenance` accepts only a `Bearer $CRON_SECRET`
(compared in constant time) or a signed-in administrator. With no `CRON_SECRET`
configured the bearer path is disabled entirely rather than falling open.

---

## Verification status

Verified on **Node 24.19.0** / **PostgreSQL 17.10** (Windows).

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run build` | 30 routes, Prisma absent from the client bundle |
| `npm test` | **152/152** |
| `npm run test:integration` | **67/67** |
| Migrations | applied to a fresh database |
| Console | no errors, no hydration warnings |

Hydration is checked structurally, not by eye: the server HTML and the live DOM
are walked node by node and compared, because a hydration failure leaves a page
that *looks* correct while every event handler on it is dead.

Exercised in the running app: sign-in; every tab; IN PROGRESS lighting a row
live; ticking Complete moving an event off the dashboard and into C1 at D-21;
ticking Done advancing D-7 → D-5 with a recalculated due date; all three themes;
Settings showing stage chips, the type list and a live timezone preview;
marketplace links generating correct search URLs; inactive users excluded from
assignee dropdowns while remaining in filters; the C1 date shortcuts reporting
correct live counts; the flag column showing a raised flag with its reason and a
Clear control; the logo rendering in the header; and the notes dialog covering
the full viewport rather than being trapped in its row.

Both marketplace URLs were checked against the live sites during development:
StubHub's `/find/s/?q=` returns "Page Not Found", `/search?q=` resolves; SeatGeek's
`/search?search=` resolves and redirects to the team page.

**Clockify is verified against a live workspace**: the key authenticates, the
configured workspace id matches the account's active workspace, the member list
resolves, and real weekly hours render on the Metrics page.

**Not verified:** Google Workspace sign-in, which needs OAuth credentials for a
real Workspace domain. Credentials sign-in is exercised throughout.

---

## Release notes

Every user-visible change gets an entry at the top of
[`lib/domain/announcements.ts`](lib/domain/announcements.ts). The next time each
person loads the app they see a "What's new" dialog with anything added since
they last dismissed it, capped at five with the remainder reported as a count.

**Adding an entry is part of shipping the change, not a follow-up.** The list is
compiled into the bundle, so the note and the code it describes travel in the
same commit and the same deploy — which is the only arrangement where they
cannot drift. A changelog kept anywhere else eventually describes a release that
failed to go out, or misses one that did.

Two rules:

- **Ids are `YYYY-MM-DD-slug` and are never reused or edited.** Every browser has
  already recorded an id as "seen"; changing one announces the wrong thing, and
  reusing one announces nothing.
- **Write for the person using the app.** "Completed events now stay visible
  under a new All filter", not "added ALL to the Scope union".

Acknowledgement is stored per browser rather than per account, so a second
machine means seeing a note twice. That is deliberate — the alternative is a
table and a migration for something nobody would miss.

---

## Credits

The favicon and app icons are derived from the **admission ticket** glyph
(`1f39f`) in [Twemoji](https://github.com/twitter/twemoji), © 2020 Twitter, Inc
and other contributors, released under
[CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).

That licence requires attribution wherever the artwork is distributed, which
includes a deployed copy of this application — so this section is a condition of
use, not a courtesy. Replacing the icons with your own artwork is the way to drop
it.

`public/jpd-logo.png` is JPD Group's own mark and is not covered by the above.
