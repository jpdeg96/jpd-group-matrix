/**
 * The business clock.
 *
 * Every "what is today?" question in the application resolves here, and it
 * always resolves against the business timezone — never the browser, never the
 * server's locale, never UTC.
 *
 * The zone is named, never expressed as an offset. Venezuela Time is currently
 * a fixed UTC-4 with no daylight saving, but it has not always been: the
 * country ran UTC-4:30 from 2007 to 2016. Resolving through the IANA database
 * means historical dates stay correct and any future change arrives with a
 * tzdata update rather than a code change.
 */

import { todayInTimeZone, type PlainDate } from "./plain-date";

/** The single business timezone. Referenced by name, never by offset. */
export const BUSINESS_TIME_ZONE = "America/Caracas" as const;

/** Today's calendar date in the business timezone. */
export function businessToday(now: Date = new Date()): PlainDate {
  return todayInTimeZone(BUSINESS_TIME_ZONE, now);
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const timeOnlyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const shortDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/**
 * Renders a stored UTC instant in the business timezone.
 * e.g. `Sep 11, 2026, 2:04 PM`
 */
export function formatBusinessTimestamp(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return dateTimeFormatter.format(date);
}

/** Compact variant for dense table cells. e.g. `9/11, 2:04 PM` */
export function formatBusinessTimestampShort(
  value: Date | string | null | undefined,
): string {
  if (value === null || value === undefined) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return shortDateTimeFormatter.format(date);
}

/** Time of day only, in the business timezone. e.g. `2:04 PM` */
export function formatBusinessTime(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return timeOnlyFormatter.format(date);
}

/**
 * The zone abbreviation for the given instant, so users can see which clock
 * they are reading. Resolved from the instant rather than hard-coded, so it
 * stays correct if the zone's offset ever changes again.
 */
export function businessTimeZoneAbbreviation(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    timeZoneName: "short",
  }).formatToParts(now);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-4";
}
