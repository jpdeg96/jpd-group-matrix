/**
 * Calendar-date primitives.
 *
 * A `PlainDate` is a calendar date with no time and no timezone, represented as
 * an ISO `YYYY-MM-DD` string. This is the only representation of `event_date`
 * and `review_due` anywhere in the application.
 *
 * Why a string and not a `Date`:
 * A JS `Date` is an instant. Every time you touch one you risk a UTC/local
 * conversion silently shifting the calendar day by one — exactly the class of
 * bug that would move a review deadline onto the wrong day. Strings cannot
 * drift. `Date` is used strictly as an internal calculation vehicle inside this
 * module, always through UTC accessors, and never escapes it.
 *
 * Nothing in this module reads the host machine's timezone. The single place
 * the wall clock enters the system is `todayInTimeZone`, which asks Intl for
 * the calendar date in an explicitly named zone.
 */

/** ISO `YYYY-MM-DD`. Branded so a bare string cannot be passed by accident. */
export type PlainDate = string & { readonly __brand: unique symbol };

/**
 * ISO weekday numbering: Monday = 1 … Sunday = 7.
 *
 * A frozen object rather than a `const enum`: const enums cannot be inlined
 * across files by SWC under `isolatedModules`, which is how Next.js compiles
 * this project.
 */
export const Weekday = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
} as const;

export type Weekday = (typeof Weekday)[keyof typeof Weekday];

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Raised for any value that is not a real calendar date. Never falls back. */
export class InvalidDateError extends Error {
  constructor(value: unknown) {
    super(
      `Invalid date: ${JSON.stringify(String(value))}. Expected a real calendar date in YYYY-MM-DD format.`,
    );
    this.name = "InvalidDateError";
  }
}

/**
 * True only for strings that are both well-formed and a date that actually
 * exists. `2025-02-30` and `2025-13-01` are rejected; `2024-02-29` is accepted.
 */
export function isPlainDate(value: unknown): value is PlainDate {
  if (typeof value !== "string") return false;

  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  // Round-trip through UTC. If the components survive unchanged the date is
  // real; if the day overflowed into the next month it is not.
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

/** Parses a `YYYY-MM-DD` string, throwing `InvalidDateError` if it is not one. */
export function toPlainDate(value: unknown): PlainDate {
  if (!isPlainDate(value)) throw new InvalidDateError(value);
  return value;
}

/** Same as `toPlainDate` but returns `null` instead of throwing. */
export function tryToPlainDate(value: unknown): PlainDate | null {
  return isPlainDate(value) ? value : null;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** Builds a `PlainDate` from numeric parts, validating the result. */
export function plainDateFromParts(
  year: number,
  month: number,
  day: number,
): PlainDate {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new InvalidDateError(`${year}-${month}-${day}`);
  }
  return toPlainDate(`${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`);
}

/** Decomposes a `PlainDate` into its numeric parts. */
export function plainDateParts(date: PlainDate): {
  year: number;
  month: number;
  day: number;
} {
  const match = ISO_DATE_PATTERN.exec(date);
  if (!match) throw new InvalidDateError(date);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

/** Internal: a `PlainDate` as UTC-midnight epoch milliseconds. */
function toUtcMillis(date: PlainDate): number {
  const { year, month, day } = plainDateParts(date);
  return Date.UTC(year, month - 1, day);
}

/** Internal: UTC-midnight epoch milliseconds back to a `PlainDate`. */
function fromUtcMillis(millis: number): PlainDate {
  const utc = new Date(millis);
  return plainDateFromParts(
    utc.getUTCFullYear(),
    utc.getUTCMonth() + 1,
    utc.getUTCDate(),
  );
}

/** Adds calendar days. Negative values subtract. DST is irrelevant here. */
export function addDays(date: PlainDate, days: number): PlainDate {
  if (!Number.isInteger(days)) throw new RangeError(`days must be an integer, got ${days}`);
  return fromUtcMillis(toUtcMillis(date) + days * MS_PER_DAY);
}

/** Subtracts calendar days. */
export function subtractDays(date: PlainDate, days: number): PlainDate {
  return addDays(date, -days);
}

/**
 * Whole calendar days from `from` to `to`. Positive when `to` is later.
 * `differenceInDays(eventDate, today)` is "days until the event".
 */
export function differenceInDays(to: PlainDate, from: PlainDate): number {
  return Math.round((toUtcMillis(to) - toUtcMillis(from)) / MS_PER_DAY);
}

/** ISO weekday, Monday = 1 … Sunday = 7. */
export function dayOfWeek(date: PlainDate): Weekday {
  const jsDay = new Date(toUtcMillis(date)).getUTCDay(); // 0 = Sunday
  return (jsDay === 0 ? 7 : jsDay) as Weekday;
}

export function isWeekend(date: PlainDate): boolean {
  const day = dayOfWeek(date);
  return day === Weekday.Saturday || day === Weekday.Sunday;
}

/** -1 if `a` is earlier, 0 if equal, 1 if later. Suitable for `Array.sort`. */
export function comparePlainDates(a: PlainDate, b: PlainDate): number {
  // ISO `YYYY-MM-DD` sorts lexicographically in true chronological order.
  return a < b ? -1 : a > b ? 1 : 0;
}

export const isBefore = (a: PlainDate, b: PlainDate): boolean => a < b;
export const isAfter = (a: PlainDate, b: PlainDate): boolean => a > b;
export const isSameDay = (a: PlainDate, b: PlainDate): boolean => a === b;

/**
 * The current calendar date in a named IANA timezone.
 *
 * This is the only wall-clock read in the date layer. It must be given an
 * explicit zone — there is no default — so no caller can accidentally inherit
 * the host machine's timezone. DST transitions are handled by Intl, which is
 * why no UTC offset is ever hard-coded.
 */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): PlainDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  let year = 0;
  let month = 0;
  let day = 0;
  for (const part of parts) {
    if (part.type === "year") year = Number(part.value);
    else if (part.type === "month") month = Number(part.value);
    else if (part.type === "day") day = Number(part.value);
  }

  return plainDateFromParts(year, month, day);
}

/* -------------------------------------------------------------------------- */
/* Database boundary                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Converts a Postgres `DATE` (which Prisma hands back as a `Date` pinned to
 * UTC midnight) into a `PlainDate`. Reads UTC components only — using local
 * accessors here is precisely how a date becomes the previous day west of
 * Greenwich.
 */
export function plainDateFromDbDate(value: Date): PlainDate {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new InvalidDateError(value);
  }
  return plainDateFromParts(
    value.getUTCFullYear(),
    value.getUTCMonth() + 1,
    value.getUTCDate(),
  );
}

/**
 * Converts a `PlainDate` into the UTC-midnight `Date` that Prisma writes to a
 * Postgres `DATE` column.
 */
export function dbDateFromPlainDate(date: PlainDate): Date {
  return new Date(toUtcMillis(date));
}

/* -------------------------------------------------------------------------- */
/* Display                                                                    */
/* -------------------------------------------------------------------------- */

const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const WEEKDAY_ABBREVIATIONS = [
  "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
] as const;

/** `2026-09-11` → `Sep 11, 2026`. Formatted from parts, so it cannot shift. */
export function formatPlainDate(date: PlainDate): string {
  const { year, month, day } = plainDateParts(date);
  return `${MONTH_ABBREVIATIONS[month - 1]} ${day}, ${year}`;
}

/** `2026-09-11` → `Fri, Sep 11`. Used where the weekday matters operationally. */
export function formatPlainDateWithWeekday(date: PlainDate): string {
  const { month, day } = plainDateParts(date);
  return `${WEEKDAY_ABBREVIATIONS[dayOfWeek(date) - 1]}, ${MONTH_ABBREVIATIONS[month - 1]} ${day}`;
}

/** `2026-09-11` → `Friday`. */
export function formatWeekday(date: PlainDate): string {
  const names = [
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  ] as const;
  return names[dayOfWeek(date) - 1]!;
}
