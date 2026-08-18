/**
 * User metrics.
 *
 * Aggregates the work each person actually did — completions, review stages,
 * marketplace checks, audits, notes — over a chosen period, plus the type split
 * and a daily activity series.
 *
 * Every count is attributed by the *actor* column (`completedById`,
 * `doneById`, …), not by who the row is assigned to. Assignment says who was
 * meant to do it; these columns say who did.
 */

import { prisma } from "@/lib/db/prisma";
import {
  addDays,
  dbDateFromPlainDate,
  subtractDays,
  type PlainDate,
} from "@/lib/date/plain-date";
import {
  daysInRange,
  resolveMetricsPeriod,
  startOfMonth,
  type MetricsPeriod,
  type PeriodRange,
} from "@/lib/domain/metrics-period";
import { businessToday, getSettings } from "./settings";
import { getHoursByUser, startOfBusinessDay, type WeeklyHoursResult } from "./clockify";

/**
 * How far back "all time" reaches for the hours chart.
 *
 * Clockify needs a bounded range, and paging through every entry a team has
 * ever logged on each load would be slow and pointless. A year is far past the
 * horizon anyone asks staffing questions over.
 */
const ALL_TIME_HOURS_DAYS = 365;

export interface UserMetricRow {
  userId: string;
  displayName: string;
  color: string;
  role: string;
  active: boolean;
  eventsCompleted: number;
  stagesDone: number;
  seatGeekChecks: number;
  audits: number;
  notes: number;
  /** Everything above, for ranking and the "share of work" read. */
  total: number;
}

export interface TypeSliceRow {
  typeId: string;
  name: string;
  emoji: string | null;
  count: number;
  /** Stable slot index, assigned by the type's own order — never by rank. */
  slot: number;
}

export interface DailyPoint {
  date: PlainDate;
  count: number;
}

export interface MetricsResult {
  period: MetricsPeriod;
  label: string;
  from: PlainDate | null;
  to: PlainDate;
  totals: {
    eventsCompleted: number;
    stagesDone: number;
    activePeople: number;
    /** Mean completions per calendar day in the period. */
    perDay: number;
  };
  users: UserMetricRow[];
  types: TypeSliceRow[];
  daily: DailyPoint[];
  /**
   * Hours logged over the selected period.
   *
   * `from`/`to` are the window actually queried, which is not always the
   * period's own range: all-time has no lower bound and Clockify needs one, so
   * it is capped. Reporting the real window lets the screen say so rather than
   * quietly showing a narrower figure under a broader heading.
   */
  hours: WeeklyHoursResult & { from: PlainDate; to: PlainDate; capped: boolean };
}

/** Converts an inclusive date range into the instant range the columns need. */
async function toInstantRange(range: PeriodRange): Promise<{ gte?: Date; lte: Date }> {
  const settings = await getSettings();
  const zone = settings.timeZone;

  // End of `to` is the start of the following day, exclusive — expressed here as
  // an inclusive `lte` one millisecond earlier so every query reads the same.
  const endExclusive = startOfBusinessDay(range.to, zone);
  const lte = new Date(endExclusive.getTime() + 86_400_000 - 1);

  return range.from
    ? { gte: startOfBusinessDay(range.from, zone), lte }
    : { lte };
}

/**
 * Productivity figures for a period.
 *
 * `onlyUserId` narrows every figure to one person, which is what a regular
 * user sees. It is applied to the *aggregation*, not to the rendering: nobody
 * else's counts are computed, totalled or sent, so the numbers cannot be read
 * out of a response by somebody who should not have them.
 *
 * Shared totals are narrowed to match. Leaving "events completed: 40" beside
 * one person's bar of 6 would report the team's output on a page that claims
 * to be about them.
 */
export async function getMetrics(
  period: MetricsPeriod,
  options: { onlyUserId?: string } = {},
): Promise<MetricsResult> {
  const onlyUserId = options.onlyUserId ?? null;
  const today = await businessToday();
  const range = resolveMetricsPeriod(period, today);
  const window = await toInstantRange(range);

  const [users, types, events, stages, notes] = await Promise.all([
    prisma.user.findMany({
      where: onlyUserId ? { id: onlyUserId } : {},
      select: {
        id: true,
        displayName: true,
        color: true,
        role: true,
        active: true,
      },
      orderBy: { displayName: "asc" },
    }),
    prisma.eventType.findMany({
      select: { id: true, name: true, emoji: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    // Completions in the window, with everything the per-user and per-type
    // aggregations need, fetched once rather than as a query per person.
    prisma.event.findMany({
      where: {
        completedAt: window,
        ...(onlyUserId ? { completedById: onlyUserId } : {}),
      },
      select: {
        completedAt: true,
        completedById: true,
        eventTypeId: true,
        seatGeekById: true,
        seatGeekCheckedAt: true,
        auditedById: true,
        auditedAt: true,
      },
    }),
    prisma.reviewStage.findMany({
      where: {
        status: "DONE",
        doneAt: window,
        ...(onlyUserId ? { doneById: onlyUserId } : {}),
      },
      select: { doneById: true },
    }),
    prisma.eventNote.findMany({
      where: {
        createdAt: window,
        ...(onlyUserId ? { authorId: onlyUserId } : {}),
      },
      select: { authorId: true },
    }),
  ]);

  const blank = () => ({
    eventsCompleted: 0,
    stagesDone: 0,
    seatGeekChecks: 0,
    audits: 0,
    notes: 0,
  });

  const tally = new Map<string, ReturnType<typeof blank>>();
  const bump = (id: string | null, key: keyof ReturnType<typeof blank>) => {
    if (!id) return;
    const row = tally.get(id) ?? blank();
    row[key] += 1;
    tally.set(id, row);
  };

  for (const event of events) {
    bump(event.completedById, "eventsCompleted");
    // SeatGeek and audit checks are counted only when they happened inside the
    // window too — an old check on a newly completed event is not this period's
    // work.
    if (event.seatGeekCheckedAt && inWindow(event.seatGeekCheckedAt, window)) {
      bump(event.seatGeekById, "seatGeekChecks");
    }
    if (event.auditedAt && inWindow(event.auditedAt, window)) {
      bump(event.auditedById, "audits");
    }
  }

  for (const stage of stages) bump(stage.doneById, "stagesDone");
  for (const note of notes) bump(note.authorId, "notes");

  const userRows: UserMetricRow[] = users
    .map((user) => {
      const counts = tally.get(user.id) ?? blank();
      const total =
        counts.eventsCompleted +
        counts.stagesDone +
        counts.seatGeekChecks +
        counts.audits +
        counts.notes;

      return {
        userId: user.id,
        displayName: user.displayName,
        color: user.color,
        role: user.role,
        active: user.active,
        ...counts,
        total,
      };
    })
    // Deactivated people with no activity in the window are noise; keep them
    // only when they actually did something in it.
    .filter((row) => row.active || row.total > 0)
    .sort((a, b) => b.eventsCompleted - a.eventsCompleted || b.total - a.total);

  const typeCounts = new Map<string, number>();
  for (const event of events) {
    typeCounts.set(event.eventTypeId, (typeCounts.get(event.eventTypeId) ?? 0) + 1);
  }

  // Slot follows the type's own stable order, never its count — so filtering or
  // a quiet week never repaints the chart.
  const typeRows: TypeSliceRow[] = types
    .map((type, index) => ({
      typeId: type.id,
      name: type.name,
      emoji: type.emoji,
      count: typeCounts.get(type.id) ?? 0,
      slot: index,
    }))
    .filter((row) => row.count > 0);

  const dayKeys = daysInRange(range);
  const dailyCounts = new Map<string, number>(dayKeys.map((day) => [day, 0]));
  const settings = await getSettings();

  for (const event of events) {
    if (!event.completedAt) continue;
    const day = businessDateOf(event.completedAt, settings.timeZone);
    if (dailyCounts.has(day)) dailyCounts.set(day, (dailyCounts.get(day) ?? 0) + 1);
  }

  const daily: DailyPoint[] = dayKeys.map((day) => ({
    date: day,
    count: dailyCounts.get(day) ?? 0,
  }));

  // Hours follow the selected period, so the chart answers the same question
  // as everything else on the screen.
  //
  // All-time is the exception: Clockify's time-entries endpoint needs a bounded
  // range, and an unbounded one would page through years of entries for every
  // person on every load. It is capped to a year and the screen says so.
  const hoursFrom = range.from ?? subtractDays(range.to, ALL_TIME_HOURS_DAYS);
  const capped = range.from === null;

  // The instant after the last day, clamped to now: a period that has not
  // finished must not ask Clockify about the future.
  const nowInstant = new Date();
  const endExclusive = startOfBusinessDay(addDays(range.to, 1), settings.timeZone);

  const hours = await getHoursByUser(
    startOfBusinessDay(hoursFrom, settings.timeZone),
    endExclusive > nowInstant ? nowInstant : endExclusive,
    onlyUserId ? { onlyUserId } : {},
  );

  const spanDays = dayKeys.length || 1;

  return {
    period,
    label: range.label,
    from: range.from,
    to: range.to,
    totals: {
      eventsCompleted: events.length,
      stagesDone: stages.length,
      activePeople: userRows.filter((row) => row.total > 0).length,
      perDay: Math.round((events.length / spanDays) * 10) / 10,
    },
    users: userRows,
    types: typeRows,
    daily,
    hours: { ...hours, from: hoursFrom, to: range.to, capped },
  };
}

function inWindow(value: Date, window: { gte?: Date; lte: Date }): boolean {
  if (value > window.lte) return false;
  return window.gte ? value >= window.gte : true;
}

/** The business-timezone calendar date an instant falls on. */
function businessDateOf(value: Date, timeZone: string): PlainDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}` as PlainDate;
}

/** Re-exported so the page can render the period picker without a second import. */
export { startOfMonth };
