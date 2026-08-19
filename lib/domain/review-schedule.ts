/**
 * Review scheduling rules.
 *
 * Pure functions over calendar dates. No database, no clock, no I/O — the
 * caller supplies "today" and the configured schedule. That is what makes every
 * rule here directly unit-testable, and why none of this lives in a component.
 */

import {
  addDays,
  dayOfWeek,
  differenceInDays,
  subtractDays,
  Weekday,
  type PlainDate,
} from "@/lib/date/plain-date";
import { normaliseReviewOffsets } from "./constants";

/** The scheduling knobs an administrator controls in Settings. */
export interface ScheduleConfig {
  /** Stage offsets in days, furthest-out first. */
  offsets: readonly number[];
  /** Move Saturday/Sunday deadlines back to the preceding Friday. */
  weekendAdjustment: boolean;
}

/**
 * The unadjusted deadline: `event_date − offset` calendar days.
 * May land on a weekend; `adjustWeekendDueDate` handles that.
 */
export function calculateRawReviewDue(
  eventDate: PlainDate,
  offsetDays: number,
): PlainDate {
  return subtractDays(eventDate, offsetDays);
}

/**
 * Moves a weekend deadline backward to the immediately preceding Friday.
 *
 *   Saturday → Friday (−1 day)
 *   Sunday   → Friday (−2 days)
 *   Mon–Fri  → unchanged
 *
 * Intentionally NOT a general business-day calculator. Public holidays are not
 * considered, matching the original workflow.
 */
export function adjustWeekendDueDate(date: PlainDate): PlainDate {
  switch (dayOfWeek(date)) {
    case Weekday.Saturday:
      return subtractDays(date, 1);
    case Weekday.Sunday:
      return subtractDays(date, 2);
    default:
      return date;
  }
}

/**
 * The official review due date for a stage: raw offset, then the weekend rule
 * if it is switched on.
 *
 * Two stages may legitimately produce the same result — an event whose D-7
 * lands on Friday and D-5 on the following Sunday both resolve to that Friday.
 * Expected, and never a reason to merge them.
 */
export function calculateReviewDue(
  eventDate: PlainDate,
  offsetDays: number,
  config: ScheduleConfig,
): PlainDate {
  const raw = calculateRawReviewDue(eventDate, offsetDays);
  return config.weekendAdjustment ? adjustWeekendDueDate(raw) : raw;
}

/** One planned review stage, before it exists in the database. */
export interface ReviewStagePlan {
  offsetDays: number;
  reviewDue: PlainDate;
  /**
   * True when the deadline had already passed at the moment the event reached
   * C1. These are recorded as SKIPPED rather than PENDING: they were never
   * actionable, and counting them as missed work would make productivity
   * reporting lie.
   */
  alreadyPast: boolean;
}

/**
 * The full stage schedule for an event.
 *
 * Always returns one entry per configured offset, regardless of how close the
 * event is. An event completed three days out still gets its whole history;
 * the unreachable stages are flagged rather than dropped.
 */
export function buildReviewSchedule(
  eventDate: PlainDate,
  today: PlainDate,
  config: ScheduleConfig,
): ReviewStagePlan[] {
  return normaliseReviewOffsets(config.offsets).map((offsetDays) => {
    const reviewDue = calculateReviewDue(eventDate, offsetDays, config);
    return {
      offsetDays,
      reviewDue,
      alreadyPast: differenceInDays(reviewDue, today) < 0,
    };
  });
}

/**
 * The stage a C1 row should currently display: the first still-pending one,
 * furthest-out first.
 *
 * Returns `null` when every stage is resolved, which is what takes the event
 * out of C1.
 */
export function currentStage<T extends { offsetDays: number; status: string }>(
  stages: readonly T[],
): T | null {
  const pending = stages.filter((stage) => stage.status === "PENDING");
  if (pending.length === 0) return null;

  return pending.reduce((furthest, stage) =>
    stage.offsetDays > furthest.offsetDays ? stage : furthest,
  );
}

/* -------------------------------------------------------------------------- */
/* Schedule drift                                                             */
/* -------------------------------------------------------------------------- */

export interface DriftInput {
  offsetDays: number;
  /** The date currently stored on the stage. */
  reviewDue: PlainDate;
  /** True when someone set the date by hand. */
  reviewDueOverridden: boolean;
  status: string;
}

export interface DriftResult {
  /** What the formula gives for the current event date. */
  expected: PlainDate;
  /** True when the stored date no longer matches, and it was not hand-set. */
  drifted: boolean;
}

/**
 * Compares a stage's stored review date against what the schedule would produce
 * for the event's *current* date.
 *
 * Nothing here rewrites anything — moving a deadline is an administrator's
 * decision, not a side effect of editing an event. This only reports the
 * mismatch so somebody can choose.
 *
 * Hand-set dates are never reported as drifted: marking a date manual is
 * precisely the act of opting that row out of the formula, so flagging it
 * afterwards would be arguing with a decision that was already made.
 * Resolved stages are likewise left alone — a completed review happened when it
 * happened.
 */
export function stageScheduleDrift(
  stage: DriftInput,
  eventDate: PlainDate,
  config: ScheduleConfig,
): DriftResult {
  const expected = calculateReviewDue(eventDate, stage.offsetDays, config);

  const drifted =
    stage.status === "PENDING" &&
    !stage.reviewDueOverridden &&
    expected !== stage.reviewDue;

  return { expected, drifted };
}

/** Progress through the stage list, for the "2 of 5" indicator in C1. */
export function stageProgress<T extends { status: string }>(
  stages: readonly T[],
): { resolved: number; total: number } {
  return {
    resolved: stages.filter((stage) => stage.status !== "PENDING").length,
    total: stages.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Urgency                                                                    */
/* -------------------------------------------------------------------------- */

export type DueUrgency = "OVERDUE" | "TODAY" | "TOMORROW" | "SOON" | "SCHEDULED";

/** Days from today until a deadline. 0 = today, negative = overdue. */
export function daysUntilDue(reviewDue: PlainDate, today: PlainDate): number {
  return differenceInDays(reviewDue, today);
}

/**
 * Classifies a due date for display.
 *
 * Unlike the previous design, overdue rows are a normal and permanent state
 * here: nothing archives a stage automatically, so an untouched deadline stays
 * visible — and loud — until somebody deals with it.
 */
export function classifyDueUrgency(
  reviewDue: PlainDate,
  today: PlainDate,
): DueUrgency {
  const days = daysUntilDue(reviewDue, today);
  if (days < 0) return "OVERDUE";
  if (days === 0) return "TODAY";
  if (days === 1) return "TOMORROW";
  if (days <= 3) return "SOON";
  return "SCHEDULED";
}

/** Short human phrase for a due date, e.g. `Due today`, `Due in 2 days`. */
export function describeDueDate(reviewDue: PlainDate, today: PlainDate): string {
  const days = daysUntilDue(reviewDue, today);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days === -1) return "1 day overdue";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  return `Due in ${days} days`;
}

/* -------------------------------------------------------------------------- */
/* Date-range shortcuts                                                       */
/* -------------------------------------------------------------------------- */

export type DueRangeKey = "TODAY" | "THIS_WEEK" | "NEXT_WEEK";

export interface DateRange {
  from: PlainDate;
  to: PlainDate;
}

/**
 * The Sunday of the week containing `date`.
 *
 * The business week runs Sunday to Saturday, by request. Note that this is
 * independent of the weekend rule, which moves a deadline landing on Saturday
 * or Sunday back to the preceding Friday — that rule is about when work can be
 * done, this is about how a week is bucketed for reporting.
 *
 * `dayOfWeek` is ISO-numbered (Monday 1 … Sunday 7), so the modulo maps Sunday
 * to zero and leaves it where it is.
 */
export function startOfWeek(date: PlainDate): PlainDate {
  return subtractDays(date, dayOfWeek(date) % 7);
}

/** The Saturday closing the week containing `date`. */
export function endOfWeek(date: PlainDate): PlainDate {
  return addDays(startOfWeek(date), 6);
}

/**
 * Resolves a shortcut into an inclusive date range.
 *
 * "This week" runs from today rather than from the start of the week: a filter
 * meant to answer "what do I still have to do this week?" should not surface
 * deadlines that have already passed.
 */
export function resolveDueRange(key: DueRangeKey, today: PlainDate): DateRange {
  switch (key) {
    case "TODAY":
      return { from: today, to: today };
    case "THIS_WEEK":
      return { from: today, to: endOfWeek(today) };
    case "NEXT_WEEK": {
      const nextSunday = addDays(startOfWeek(today), 7);
      return { from: nextSunday, to: addDays(nextSunday, 6) };
    }
  }
}

export function isWithinRange(date: PlainDate, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

/** Days from today until the event itself. Negative once it has passed. */
export function daysUntilEvent(eventDate: PlainDate, today: PlainDate): number {
  return differenceInDays(eventDate, today);
}

/**
 * A dashboard event whose date has passed but which was never completed.
 *
 * Promotion is manual now, so nothing moves these along on its own — they are
 * flagged so they cannot quietly rot on the dashboard.
 */
export function isStaleDashboardEvent(
  eventDate: PlainDate,
  today: PlainDate,
  completed: boolean,
): boolean {
  return !completed && differenceInDays(eventDate, today) < 0;
}

/**
 * How long a completed event can sit untouched before it is worth a second
 * look. Days, measured from the Complete timestamp.
 */
export const STALE_COMPLETION_DAYS = 30;

/**
 * Whole days since an instant. Negative values clamp to 0 so clock skew between
 * the database and the renderer cannot produce a nonsensical age.
 */
/**
 * Whole 24-hour periods elapsed since an instant.
 *
 * NOT a calendar-day count, and must not be used as one. Something finished at
 * 23:00 and looked at nine hours later is zero periods old but was plainly
 * yesterday — which is exactly how the dashboard came to label yesterday's
 * completions "today". Use `calendarDaysSince` for anything a person reads as
 * a day.
 *
 * Kept for durations that genuinely are elapsed time rather than dates.
 */
export function elapsedDaysSince(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

/**
 * Calendar days between two business dates.
 *
 * Both are `PlainDate`, so the timezone question was settled server-side before
 * either got here and this is plain date arithmetic. Yesterday is 1 however few
 * hours ago it was, and today is 0 however many.
 */
export function calendarDaysSince(
  completedOn: PlainDate | null,
  today: PlainDate,
): number | null {
  if (!completedOn) return null;
  return Math.max(0, differenceInDays(today, completedOn));
}

/**
 * A promoted event whose Complete timestamp is old.
 *
 * Measured from `completedAt` specifically, not from any edit: an event that
 * was signed off six weeks ago and has been sitting in C1 ever since is the
 * thing worth surfacing, and a stray note or reassignment should not reset that
 * clock.
 */
export function isStaleCompletion(
  completedOn: PlainDate | null,
  today: PlainDate,
  thresholdDays: number = STALE_COMPLETION_DAYS,
): boolean {
  const age = calendarDaysSince(completedOn, today);
  return age !== null && age >= thresholdDays;
}

/**
 * A dashboard event already inside its first review window but not yet
 * completed — i.e. staging work should arguably have started.
 */
export function isDashboardEventOverdueForStaging(
  eventDate: PlainDate,
  today: PlainDate,
  completed: boolean,
  config: ScheduleConfig,
): boolean {
  if (completed) return false;

  const offsets = normaliseReviewOffsets(config.offsets);
  const firstOffset = offsets[0];
  if (firstOffset === undefined) return false;

  const firstDue = calculateReviewDue(eventDate, firstOffset, config);
  return differenceInDays(firstDue, today) < 0;
}
