/**
 * Reporting periods.
 *
 * Pure calendar arithmetic over `PlainDate`, so every boundary is directly
 * testable and none of it depends on the host clock. The caller supplies
 * "today" in the business timezone.
 */

import {
  addDays,
  plainDateFromParts,
  plainDateParts,
  subtractDays,
  type PlainDate,
} from "@/lib/date/plain-date";
import { endOfWeek, startOfWeek } from "./review-schedule";

export const METRICS_PERIODS = [
  "TODAY",
  "YESTERDAY",
  "THIS_WEEK",
  "LAST_WEEK",
  "THIS_MONTH",
  "LAST_MONTH",
  "YTD",
  "ALL_TIME",
] as const;

export type MetricsPeriod = (typeof METRICS_PERIODS)[number];

export const PERIOD_LABELS: Record<MetricsPeriod, string> = {
  TODAY: "Today",
  YESTERDAY: "Yesterday",
  THIS_WEEK: "This week",
  LAST_WEEK: "Last week",
  THIS_MONTH: "This month",
  LAST_MONTH: "Last month",
  YTD: "Year to date",
  ALL_TIME: "All time",
};

export interface PeriodRange {
  /** Inclusive. `null` for all-time, which has no lower bound. */
  from: PlainDate | null;
  /** Inclusive. */
  to: PlainDate;
  label: string;
}

/** First day of the month containing `date`. */
export function startOfMonth(date: PlainDate): PlainDate {
  const { year, month } = plainDateParts(date);
  return plainDateFromParts(year, month, 1);
}

/** Last day of the month containing `date`. */
export function endOfMonth(date: PlainDate): PlainDate {
  const { year, month } = plainDateParts(date);
  // Day 1 of the next month, minus a day — avoids hard-coding month lengths
  // and gets February right in leap years for free.
  const nextMonth =
    month === 12
      ? plainDateFromParts(year + 1, 1, 1)
      : plainDateFromParts(year, month + 1, 1);
  return subtractDays(nextMonth, 1);
}

/**
 * Resolves a period into an inclusive date range.
 *
 * Periods that include today end at today rather than at the end of the
 * calendar unit: "this month" means the part of it that has happened, not a
 * window with a fortnight of guaranteed zeroes in it that would drag every
 * average down.
 */
export function resolveMetricsPeriod(
  period: MetricsPeriod,
  today: PlainDate,
): PeriodRange {
  const label = PERIOD_LABELS[period];

  switch (period) {
    case "TODAY":
      return { from: today, to: today, label };

    case "YESTERDAY": {
      const yesterday = subtractDays(today, 1);
      return { from: yesterday, to: yesterday, label };
    }

    case "THIS_WEEK":
      return { from: startOfWeek(today), to: today, label };

    case "LAST_WEEK": {
      const lastMonday = subtractDays(startOfWeek(today), 7);
      return { from: lastMonday, to: endOfWeek(lastMonday), label };
    }

    case "THIS_MONTH":
      return { from: startOfMonth(today), to: today, label };

    case "LAST_MONTH": {
      const lastMonthDay = subtractDays(startOfMonth(today), 1);
      return {
        from: startOfMonth(lastMonthDay),
        to: endOfMonth(lastMonthDay),
        label,
      };
    }

    case "YTD": {
      const { year } = plainDateParts(today);
      return { from: plainDateFromParts(year, 1, 1), to: today, label };
    }

    case "ALL_TIME":
      return { from: null, to: today, label };
  }
}

export function isMetricsPeriod(value: unknown): value is MetricsPeriod {
  return (
    typeof value === "string" && (METRICS_PERIODS as readonly string[]).includes(value)
  );
}

/**
 * Every day in the range, for charting activity over time.
 *
 * Capped so an all-time range on a long-lived database cannot try to render
 * thousands of bars; past the cap the caller should aggregate by week.
 */
export function daysInRange(
  range: PeriodRange,
  maxDays = 120,
): PlainDate[] {
  if (!range.from) return [];

  const days: PlainDate[] = [];
  let cursor = range.from;

  while (cursor <= range.to && days.length < maxDays) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return days;
}
