/**
 * Clockify time summaries.
 *
 * Answers two questions: how long have I worked (this session, today, this
 * week), and who else is clocked in right now.
 *
 * The feature is entirely optional. If it is switched off, unconfigured, or
 * Clockify is unreachable, this returns a disabled/errored result and the UI
 * simply does not show the widget — it never breaks a page.
 */

import { prisma } from "@/lib/db/prisma";
import {
  getRunningEntry,
  getTimeEntries,
  getWorkspaceUsers,
  isClockifyConfigured,
  ClockifyError,
  type ClockifyTimeEntry,
} from "@/lib/clockify/client";
import { secondsSince, sumSecondsWithinWindow } from "@/lib/clockify/duration";
import { getSettings } from "./settings";
import { startOfWeek } from "@/lib/domain/review-schedule";
import { todayInTimeZone, type PlainDate } from "@/lib/date/plain-date";

export interface ClockifySummary {
  enabled: boolean;
  /** Set when the feature is on but could not be used, for an inline notice. */
  error: string | null;
  linked: boolean;
  /** Seconds on the timer currently running, or null when clocked out. */
  runningSeconds: number | null;
  runningSince: string | null;
  runningDescription: string | null;
  todaySeconds: number;
  weekSeconds: number;
  /** Everyone else with a timer running right now. */
  clockedIn: Array<{
    userId: string;
    displayName: string;
    color: string;
    since: string;
    seconds: number;
    description: string | null;
  }>;
}

const DISABLED: ClockifySummary = {
  enabled: false,
  error: null,
  linked: false,
  runningSeconds: null,
  runningSince: null,
  runningDescription: null,
  todaySeconds: 0,
  weekSeconds: 0,
  clockedIn: [],
};

/**
 * The instant a business day starts, in the configured timezone.
 *
 * Clockify works in instants, but "today" is a business-date question — so the
 * boundary is computed from the business timezone rather than the server's.
 */
export function startOfBusinessDay(date: PlainDate, timeZone: string): Date {
  // Walk back from UTC midnight until the instant renders as `date` in the
  // business zone. Cheap, and correct for any offset including half-hours.
  const utcMidnight = new Date(`${date}T00:00:00Z`);
  for (let offsetHours = -14; offsetHours <= 14; offsetHours += 0.5) {
    const candidate = new Date(utcMidnight.getTime() + offsetHours * 3_600_000);
    const previous = new Date(candidate.getTime() - 1000);
    if (
      todayInTimeZone(timeZone, candidate) === date &&
      todayInTimeZone(timeZone, previous) !== date
    ) {
      return candidate;
    }
  }
  return utcMidnight;
}

/*
 * `sumEntries` used to live here and added every entry's full duration, with a
 * running one counted as elapsed-time-until-now. Both over-reported: see
 * `secondsWithinWindow`, which every total now goes through. It is kept pure
 * and in the duration module so the arithmetic is testable without a network.
 */

export async function getClockifySummary(
  userId: string,
  now: Date = new Date(),
): Promise<ClockifySummary> {
  const settings = await getSettings();

  if (!settings.clockifyEnabled || !settings.clockifyWorkspaceId) return DISABLED;
  if (!isClockifyConfigured()) {
    return {
      ...DISABLED,
      enabled: true,
      error: "CLOCKIFY_API_KEY is not set on the server.",
    };
  }

  const workspaceId = settings.clockifyWorkspaceId;
  const today = todayInTimeZone(settings.timeZone, now);
  const dayStart = startOfBusinessDay(today, settings.timeZone);
  const weekStart = startOfBusinessDay(startOfWeek(today), settings.timeZone);

  const [me, linkedUsers] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { clockifyUserId: true },
    }),
    prisma.user.findMany({
      where: { active: true, clockifyUserId: { not: null } },
      select: { id: true, displayName: true, color: true, clockifyUserId: true },
    }),
  ]);

  try {
    let runningSeconds: number | null = null;
    let runningSince: string | null = null;
    let runningDescription: string | null = null;
    let todaySeconds = 0;
    let weekSeconds = 0;

    if (me?.clockifyUserId) {
      const [weekEntries, running] = await Promise.all([
        getTimeEntries(workspaceId, me.clockifyUserId, { start: weekStart, end: now }),
        getRunningEntry(workspaceId, me.clockifyUserId),
      ]);

      // Both totals come from the same fetched entries, each clamped to its own
      // window. Today is no longer "entries that started today, in full" —
      // which credited a shift beginning at 23:00 entirely to the day it began
      // on, and gave a shift that ran in from last night nothing at all.
      const intervals = weekEntries.map((entry) => entry.timeInterval);

      weekSeconds = sumSecondsWithinWindow(intervals, { from: weekStart, to: now }, now);
      todaySeconds = sumSecondsWithinWindow(intervals, { from: dayStart, to: now }, now);

      if (running) {
        runningSeconds = secondsSince(running.timeInterval.start, now);
        runningSince = running.timeInterval.start;
        runningDescription = running.description || null;
      }
    }

    // Who else is on the clock. Sequential-ish but bounded: only linked, active
    // users are queried, which for an internal team is a handful.
    const others = linkedUsers.filter((user) => user.id !== userId);
    const running = await Promise.all(
      others.map(async (user) => {
        try {
          const entry = await getRunningEntry(workspaceId, user.clockifyUserId!);
          if (!entry) return null;
          return {
            userId: user.id,
            displayName: user.displayName,
            color: user.color,
            since: entry.timeInterval.start,
            seconds: secondsSince(entry.timeInterval.start, now),
            description: entry.description || null,
          };
        } catch {
          // One unreachable user must not blank the whole roster.
          return null;
        }
      }),
    );

    return {
      enabled: true,
      error: null,
      linked: Boolean(me?.clockifyUserId),
      runningSeconds,
      runningSince,
      runningDescription,
      todaySeconds,
      weekSeconds,
      clockedIn: running.filter(
        (entry): entry is NonNullable<typeof entry> => entry !== null,
      ),
    };
  } catch (error) {
    const message =
      error instanceof ClockifyError
        ? error.message
        : "Could not read time data from Clockify.";
    console.error("[clockify] summary failed", error);
    return { ...DISABLED, enabled: true, linked: Boolean(me?.clockifyUserId), error: message };
  }
}

export interface WeeklyHoursEntry {
  userId: string;
  displayName: string;
  color: string;
  seconds: number;
}

export interface WeeklyHoursResult {
  enabled: boolean;
  error: string | null;
  entries: WeeklyHoursEntry[];
  /** People excluded from the comparison by the per-user toggle. */
  excludedNames: string[];
}

/**
 * Hours logged per person across a date range, for the Metrics page.
 *
 * Users flagged `excludeFromTimeReport` are left out — typically owners and
 * administrators whose hours are not comparable to operational staff and would
 * flatten the chart. Their names are still returned so the exclusion is visible
 * rather than silent.
 *
 * Anyone unlinked from Clockify is omitted entirely: showing them as a zero bar
 * would read as "did no work" rather than "not measured".
 */
export async function getHoursByUser(
  start: Date,
  end: Date,
  options: { onlyUserId?: string } = {},
): Promise<WeeklyHoursResult> {
  const settings = await getSettings();

  if (!settings.clockifyEnabled || !settings.clockifyWorkspaceId) {
    return { enabled: false, error: null, entries: [], excludedNames: [] };
  }
  if (!isClockifyConfigured()) {
    return {
      enabled: true,
      error: "CLOCKIFY_API_KEY is not set on the server.",
      entries: [],
      excludedNames: [],
    };
  }

  const workspaceId = settings.clockifyWorkspaceId;

  const linked = await prisma.user.findMany({
    where: {
      active: true,
      clockifyUserId: { not: null },
      // A person looking at their own metrics gets their own hours and no
      // reason to infer anybody else's from the shape of the chart.
      ...(options.onlyUserId ? { id: options.onlyUserId } : {}),
    },
    select: {
      id: true,
      displayName: true,
      color: true,
      clockifyUserId: true,
      excludeFromTimeReport: true,
    },
    orderBy: { displayName: "asc" },
  });

  const included = options.onlyUserId
    ? linked
    : linked.filter((user) => !user.excludeFromTimeReport);
  const excludedNames = linked
    .filter((user) => user.excludeFromTimeReport)
    .map((user) => user.displayName);

  try {
    const now = new Date();

    const entries = await Promise.all(
      included.map(async (user) => {
        try {
          const rows = await getTimeEntries(workspaceId, user.clockifyUserId!, {
            start,
            end,
          });
          return {
            userId: user.id,
            displayName: user.displayName,
            color: user.color,
            // Clamped to the range asked for, so a timer somebody left
            // running does not credit the whole period since they forgot.
            seconds: sumSecondsWithinWindow(
              rows.map((row) => row.timeInterval),
              { from: start, to: end },
              now,
            ),
          };
        } catch {
          // One unreachable member must not blank the whole chart; they simply
          // report zero for this run.
          return {
            userId: user.id,
            displayName: user.displayName,
            color: user.color,
            seconds: 0,
          };
        }
      }),
    );

    return {
      enabled: true,
      error: null,
      entries: entries.sort((a, b) => b.seconds - a.seconds),
      excludedNames,
    };
  } catch (error) {
    const message =
      error instanceof ClockifyError
        ? error.message
        : "Could not read time data from Clockify.";
    console.error("[clockify] hours-by-user failed", error);
    return { enabled: true, error: message, entries: [], excludedNames };
  }
}

/** Workspace members, for the admin mapping dropdown in Users. */
export async function listClockifyUsers(): Promise<
  Array<{ id: string; name: string; email: string }>
> {
  const settings = await getSettings();
  if (!settings.clockifyEnabled || !settings.clockifyWorkspaceId) return [];
  if (!isClockifyConfigured()) return [];

  try {
    const users = await getWorkspaceUsers(settings.clockifyWorkspaceId);
    return users
      .filter((user) => user.status === "ACTIVE")
      .map((user) => ({ id: user.id, name: user.name, email: user.email }));
  } catch (error) {
    console.error("[clockify] could not list workspace users", error);
    return [];
  }
}
