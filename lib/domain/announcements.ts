/**
 * What changed, announced to everyone on their next load.
 *
 * This list ships *with* the code it describes. That is the whole point: an
 * announcement stored in the database, or written by hand after the fact, can
 * describe a release that failed to deploy — or quietly not describe one that
 * did. Here the two land in the same commit and the same build, so the two
 * cannot disagree.
 *
 * ## Adding an entry
 *
 * Put the newest at the TOP. Give it an id that will never be reused —
 * `YYYY-MM-DD-short-slug` — because that id is what every browser has already
 * recorded as "seen"; editing an existing id re-announces it to nobody, and
 * reusing one announces the wrong thing.
 *
 * Write the body for the person using the app, not the person who wrote it.
 * "Completed events now stay visible under a new All filter" — not "added ALL
 * to the Scope union".
 */

export type AnnouncementKind = "added" | "changed" | "fixed" | "removed";

export interface Announcement {
  /** Stable and never reused. `YYYY-MM-DD-slug`. */
  id: string;
  /** Shown as-is; the business date the change shipped. */
  date: string;
  kind: AnnouncementKind;
  title: string;
  body: string;
}

/**
 * At most this many are shown at once.
 *
 * Somebody returning from two weeks off should get a readable summary, not a
 * wall they dismiss without reading. Anything beyond the cap is reported as a
 * count rather than expanded.
 */
export const MAX_SHOWN = 5;

/** Newest first. */
export const ANNOUNCEMENTS: readonly Announcement[] = [
  {
    id: "2026-08-29-columns",
    date: "Aug 29, 2026",
    kind: "added",
    title: "Choose which columns to show",
    body: "A Columns button at the bottom of the Dashboard and C1 turns individual columns off, so the table can fit a laptop screen without scrolling sideways. Hide what you do not use and the table narrows to match — it is not a fixed width any more. Date and Away Team / Artist always stay, since a row cannot be identified without them. Your choice is remembered on that machine, per table, and Show every column puts them all back.",
  },
  {
    id: "2026-08-28-sheet-import",
    date: "Aug 28, 2026",
    kind: "added",
    title: "Bulk import can read a linked Google Sheet",
    body: "Link a spreadsheet under Settings → Import spreadsheet (paste its ID or its whole URL, and share the sheet with the service account as a Viewer). Bulk import then has a Load from the linked sheet button, and a link straight to the sheet next to it. The rows go through exactly the same preview as a paste, so you still see what will be created before anything is written — and the sheet is re-read at the moment you import, so a change made while you were reviewing is picked up rather than missed.",
  },
  {
    id: "2026-08-28-c1-paging-and-fixes",
    date: "Aug 28, 2026",
    kind: "fixed",
    title: "Start works in C1 again, and unticking Complete reopens an event",
    body: "Start was refusing every row in C1. The rule that stops you starting an event ticked Complete was being applied there too — but everything in C1 is ticked Complete, that is how it got there — so it blocked the entire screen. It now applies to the Dashboard only. Separately, unticking Complete puts an event back under Open where it belongs: it stays in C1 with its review work intact, so it is outstanding on the Dashboard and still progressing through review at the same time. C1 also gets the paging and row shading the Dashboard has, remembered separately from it.",
  },
  {
    id: "2026-08-27-c1-paging-and-open-fix",
    date: "Aug 27, 2026",
    kind: "fixed",
    title: "Start works in C1 again, and unticking Complete reopens the event",
    body: "Start was refused on every row in C1. Getting an event into C1 means ticking Complete, and a rule meant for the Dashboard — do not start work already marked finished — was being applied there too, so it turned down everything. It now only applies on the Dashboard. Separately, unticking Complete put the event back on the board but left it filed under Completed, with no way to get it back: Open and Completed now follow the tick rather than the status, so unticking returns it to Open immediately while its C1 review carries on untouched. C1 also gains the Dashboard's paging (50, 100, 250 or All, remembered per machine) and the Shade alternate rows option.",
  },
  {
    id: "2026-08-27-bell-refinements",
    date: "Aug 27, 2026",
    kind: "changed",
    title: "Notifications arrive as they happen, and payroll stays off Discord",
    body: "The bell now updates live — a flag raised on your event appears within a couple of seconds without reloading. Hovering a notification outlines it so you can see which one you are about to open, and there is a Clear button to empty the list (Mark all read only says you have seen them). Names you are mentioned by now appear in that person's own colour wherever the note is shown. On a flag, Mark as dealt with is now Mark as Resolved. Separately, payroll remittance no longer posts to Discord: the channel has no per-person addressing, so a run put the week's figures in front of everybody who could read it. Releases and Clockify outages still post; the administrator's summary email and the audit log are unchanged.",
  },
  {
    id: "2026-08-26-notifications-and-ownership",
    date: "Aug 26, 2026",
    kind: "added",
    title: "A notification bell, and rows now belong to whoever holds them",
    body: "There is a bell in the header. It tells you when a manager flags an event assigned to you, when somebody flags one and you are a manager, when a flag you raised is cleared, and when anybody writes your name into a note — type @ in a note to mention somebody and pick them from the list. Click a notification to open that exact event. Flags now have a middle step: if a flag is yours to deal with, Mark as dealt with tells the managers it is ready to check, and it stays flagged until one of them clears it. Separately, the checkboxes, flag, notes and Start on an event now belong to whoever it is assigned to — unassigned rows stay open to everyone, and managers can still do anything. Ticking Complete now stops your in progress badge, and you cannot start an event that is ticked Complete unless an administrator has granted you that exception on your user.",
  },
  {
    id: "2026-08-26-table-options",
    date: "Aug 26, 2026",
    kind: "added",
    title: "Pages, row shading, and a clearer team panel",
    body: "The Dashboard now pages: choose 50, 100, 250 or All at the bottom, and it is remembered on that machine between sessions. There is a Shade alternate rows option beside it if banding helps you track across a wide row. And in the Team panel, hovering an entry outlines it, so it is obvious which person and event you are about to open.",
  },
  {
    id: "2026-08-26-bulk-actions",
    date: "Aug 26, 2026",
    kind: "added",
    title: "Change many events at once",
    body: "Bulk actions on the Dashboard puts a checkbox on every row. Tick the ones you want — the selection survives changing the filters, so you can gather rows from several searches — and a Select Action(s) button appears in the bottom right. From there you can set the type, away team or artist, home team, venue or assignee, raise or clear a flag, add a note to all of them, or delete them. Every change is opt-in: tick the field to change it and everything else is left alone. You then get a review screen listing each event and exactly what will happen to it, including any that will be skipped and why, before anything is written. Deleting is separate and cannot be combined with an edit; anything with completed review work is cancelled rather than deleted so the record is kept. Managers and administrators.",
  },
  {
    id: "2026-08-25-team-presence",
    date: "Aug 25, 2026",
    kind: "added",
    title: "See who is working on what, from anywhere",
    body: "A Team chip in the header shows how many people are marked as in progress right now. Open it for the list: who, which event, and how long they have been on it, across the Dashboard and C1 together. Oldest first, so anything that has been open a while is at the top and shows its time in amber past 45 minutes. Click any entry to open that exact event — it clears the filters and takes you to the row. Managers and administrators only.",
  },
  {
    id: "2026-08-25-start-and-flags",
    date: "Aug 25, 2026",
    kind: "changed",
    title: "Start is for your own work, and flags open in full",
    body: "Start now only works on events assigned to you — claim the row first and the button lights up. Managers can still start on anything, and you can always stop something you already started even if it has since been moved to somebody else. Separately, a flag is now clickable: it opens the whole reason, however long, along with who raised it and when. It used to be a hover tooltip, which cut off and was no use at all on a phone.",
  },
  {
    id: "2026-08-19-complete-and-assignment",
    date: "Aug 19, 2026",
    kind: "changed",
    title: "Unticking Complete is safe, and assignment is claim-only",
    body: "Unticking Complete no longer touches C1: the event stays where it is and every review checkpoint already ticked is kept. That means you can correct an event after ticking it, which is what the stale filter is there to catch. Sending to C1 still requires Complete to be ticked. Separately, you can now only claim work nobody has taken — releasing your own or taking a row off somebody else goes through a manager. And a completion late in the evening now reads as yesterday rather than today.",
  },
  {
    id: "2026-08-17-review-work-done",
    date: "Aug 17, 2026",
    kind: "fixed",
    title: "Clicking a C1 stages bar now shows the work",
    body: "It opened an empty C1 page. Finishing an events reviews is exactly what removes it from C1, so filtering C1 by who did the work could only ever find the few still in progress. It now opens a Review work done list: one row per checkpoint ticked, including events that have since finished, with the date, which checkpoint it was, and where the event ended up.",
  },
  {
    id: "2026-08-17-workflow-changes",
    date: "Aug 17, 2026",
    kind: "changed",
    title: "Complete no longer sends an event to C1 on its own",
    body: "Ticking Complete now records that the dashboard work is finished and nothing else — no review stages are created, so a mis-click costs nothing. A Send to C1 button sits to the right of TicketData, and a Ready for C1 chip counts everything ticked but not yet sent. Events already in C1 are unaffected.",
  },
  {
    id: "2026-08-17-metrics-and-fixes",
    date: "Aug 17, 2026",
    kind: "changed",
    title: "Your own metrics, clickable charts, and a few fixes",
    body: "Metrics is open to everyone now — you see your own figures, managers see the team. Clicking a bar opens exactly those events. C1 has a Notes column, so notes and flags left on the Dashboard travel with the event. The marketplace links are gone. Rows no longer jump a line when you tick a box, and Clockify hours no longer inflate when somebody forgets to clock out.",
  },
  {
    id: "2026-08-16-phantom-calculator-rates",
    date: "Aug 16, 2026",
    kind: "added",
    title: "Matrix now sets the Phantom Calculator rates",
    body: "Settings has a Phantom Calculator section holding the Tier 1 and StubHub rates. The desktop Phantom Calculator reads them from here, so changing a rate once updates every copy — nobody has to be told, and no two people can be working from different numbers. Enter them as decimals: 0.20 means 20%. The card shows each one back as a percentage and works a $600 example through, so a rate typed as 20 instead of 0.20 is obvious before it is saved. Administrators only.",
  },
  {
    id: "2026-08-16-manual-invoices",
    date: "Aug 16, 2026",
    kind: "added",
    title: "One-off invoices for bonuses and reimbursements",
    body: "Add manual invoice on the Invoices screen raises an invoice that is not driven by hours. Pick the contractor, the week it should be paid with, say what it is for, and give an amount. It takes a -M1 number so it is never confused with that week's wage invoice, goes out with the same remittance, and gets its own PDF. Administrators only.",
  },
  {
    id: "2026-08-16-backfill-invoices",
    date: "Aug 16, 2026",
    kind: "added",
    title: "Older invoices can be filed into Drive too",
    body: "The Invoices screen has a File to Drive button whenever any invoice has no copy in the folder — invoices issued before Drive archiving was switched on, and any whose upload failed. It works in batches and tells you how many are left; press it again to continue.",
  },
  {
    id: "2026-08-16-integrations",
    date: "Aug 16, 2026",
    kind: "added",
    title: "Invoices file themselves into Drive, and Discord gets the news",
    body: "Every invoice PDF is now copied into a Google Drive folder as it is generated, with a Drive link beside the PDF link on the Invoices screen. Discord gets a post when a release goes live, when payroll remittance is sent, and when Clockify stops or starts responding. Both are switched on in Settings and neither can hold up the work it reports on — an invoice still generates and still emails if Drive is down.",
  },
  {
    id: "2026-08-16-c1-opens-on-today",
    date: "Aug 16, 2026",
    kind: "changed",
    title: "C1 opens on today's reviews",
    body: "C1 now lands on the checkpoints due today rather than the whole pipeline. The Today chip stays lit so you can see the filter is on; This week, Next week, or clicking Today again gives you everything.",
  },
  {
    id: "2026-08-16-clickable-counters",
    date: "Aug 16, 2026",
    kind: "added",
    title: "The Dashboard counters are now filters",
    body: "Click any figure in the Dashboard header — unassigned, SeatGeek to do, TicketData to do, to audit, mine — to show exactly those rows. Click it again, or click open, to go back to everything.",
  },
  {
    id: "2026-08-16-legacy-import",
    date: "Aug 16, 2026",
    kind: "added",
    title: "Everything from the PhantomChecker spreadsheet is now in here",
    body: "The Dashboard and C1 have been loaded from the spreadsheet — dates, types, teams, venues, completion timestamps, review checkpoints and notes. Those rows carry a Legacy badge, because the spreadsheet never recorded who did what: they have no assignee, nobody against a completion and no note author. That is the source, not lost data. A few events were marked complete without any checkpoints behind them; those were given the standard 14/7/3/1 day schedule so the work still shows up in C1. From here the spreadsheet is history — work in the app.",
  },
  {
    id: "2026-08-16-guide",
    date: "Aug 16, 2026",
    kind: "added",
    title: "A guide, from the Guide button in the header",
    body: "Explains what each screen is for and the behaviours that catch people out — why an event disappears, why an approved payroll week refuses to change. There is a search box, and a section on what to check when something looks wrong.",
  },
  {
    id: "2026-08-15-invoice-pdfs",
    date: "Aug 15, 2026",
    kind: "added",
    title: "Invoice PDFs and remittance emails",
    body: "Every invoice now has a PDF, opened from the PDF link on the Invoices screen. Send remittance on the Payroll dashboard emails each contractor their invoice as an attachment and sends the administrator a summary with a total.",
  },
  {
    id: "2026-08-15-payroll",
    date: "Aug 15, 2026",
    kind: "added",
    title: "Payroll",
    body: "A new Payroll tab replaces the payroll spreadsheet. Import a week's Clockify time, review each contractor's hours and pay, approve them, and generate invoices — with payment and USDT transaction hashes recorded against each one. Managers review and approve; administrators import, invoice and record payments.",
  },
  {
    id: "2026-08-14-week-runs-sunday",
    date: "Aug 14, 2026",
    kind: "changed",
    title: "The work week now runs Sunday to Saturday",
    body: "Anywhere the app talks about a week — the Metrics period filter, the C1 This week and Next week shortcuts, and the hours totals — a week now starts on Sunday and ends on Saturday. It used to run Monday to Sunday, so those figures will shift.",
  },
  {
    id: "2026-08-14-hours-follow-period",
    date: "Aug 14, 2026",
    kind: "changed",
    title: "Hours worked follows the period you pick",
    body: "On the Metrics page the hours chart used to always show this week, whatever period was selected. It now matches the filter — today, last month, year to date and so on — and the heading says which.",
  },
  {
    id: "2026-08-14-clockify-refresh",
    date: "Aug 14, 2026",
    kind: "added",
    title: "Refresh the Clockify chip yourself",
    body: "If time data ever shows as unavailable, click the chip in the header and press Refresh to re-read it straight away rather than waiting for the next automatic check. It also now shows when it last updated.",
  },
  {
    id: "2026-08-13-release-notes",
    date: "Aug 13, 2026",
    kind: "added",
    title: "You'll now be told what changed",
    body: "When the app is updated, a short note like this one appears the next time you load it. Dismiss it and it won't come back.",
  },
  {
    id: "2026-08-13-all-filter",
    date: "Aug 13, 2026",
    kind: "added",
    title: "An All filter on the Event Dashboard",
    body: "Shows open and completed work together. Completed rows stay dimmed so you can still tell the two apart at a glance.",
  },
  {
    id: "2026-08-13-live-updates",
    date: "Aug 13, 2026",
    kind: "added",
    title: "The Dashboard and C1 now update live",
    body: "When somebody ticks a box, promotes an event to C1 or deletes one, it appears on your screen within a couple of seconds. No refresh needed.",
  },
  {
    id: "2026-08-12-in-progress-sticks",
    date: "Aug 12, 2026",
    kind: "fixed",
    title: "In progress no longer disappears when you change screens",
    body: "Marking yourself as working on an event used to be dropped the moment you left the Dashboard. It now stays until you stop it, complete the event, or it times out — and a green banner shows what you're on from any screen.",
  },
  {
    id: "2026-08-12-daily-milestones",
    date: "Aug 12, 2026",
    kind: "added",
    title: "Daily completion milestones",
    body: "Hit 30, 45 or 60 completed events inside an eight-hour shift and you'll get a bit of confetti. Timed from Clockify.",
  },
  {
    id: "2026-08-11-clock-notifications",
    date: "Aug 11, 2026",
    kind: "added",
    title: "Clock-in and clock-out notifications",
    body: "A small toast appears when you clock in or out, and when anyone else on the team does.",
  },
];

export interface AnnouncementSelection {
  /** Newest first, capped at `MAX_SHOWN`. */
  shown: Announcement[];
  /** How many further unseen entries were left out of `shown`. */
  hiddenCount: number;
}

const NOTHING: AnnouncementSelection = { shown: [], hiddenCount: 0 };

/**
 * What to show somebody whose last acknowledged entry was `lastSeenId`.
 *
 * Position in the list is authoritative rather than the date string, because
 * the dates are display text and the ordering is a documented invariant of the
 * array itself.
 *
 * An id that is not in the list — localStorage carried over from a build where
 * an entry was renamed, or simply corrupted — falls back to showing the most
 * recent entries. Re-showing something once is a far cheaper mistake than going
 * permanently silent, which nobody would ever notice or report.
 */
export function selectAnnouncements(
  lastSeenId: string | null,
  announcements: readonly Announcement[] = ANNOUNCEMENTS,
): AnnouncementSelection {
  if (announcements.length === 0) return NOTHING;

  if (lastSeenId !== null) {
    const index = announcements.findIndex((entry) => entry.id === lastSeenId);
    // Everything above the acknowledged entry is newer, so unseen.
    if (index === 0) return NOTHING;
    if (index > 0) {
      const unseen = announcements.slice(0, index);
      return {
        shown: unseen.slice(0, MAX_SHOWN),
        hiddenCount: Math.max(unseen.length - MAX_SHOWN, 0),
      };
    }
  }

  return {
    shown: announcements.slice(0, MAX_SHOWN),
    hiddenCount: Math.max(announcements.length - MAX_SHOWN, 0),
  };
}

/** The id to record once a selection has been acknowledged. */
export function newestAnnouncementId(
  announcements: readonly Announcement[] = ANNOUNCEMENTS,
): string | null {
  return announcements[0]?.id ?? null;
}
