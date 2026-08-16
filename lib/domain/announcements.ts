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
