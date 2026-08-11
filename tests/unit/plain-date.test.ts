import { describe, expect, it } from "vitest";
import {
  addDays,
  comparePlainDates,
  dayOfWeek,
  dbDateFromPlainDate,
  differenceInDays,
  formatPlainDate,
  InvalidDateError,
  isPlainDate,
  isWeekend,
  plainDateFromDbDate,
  subtractDays,
  toPlainDate,
  todayInTimeZone,
  Weekday,
} from "@/lib/date/plain-date";
import { businessToday, BUSINESS_TIME_ZONE } from "@/lib/date/business-time";

// vitest.config.ts pins TZ to Pacific/Kiritimati (UTC+14). Nothing below may
// depend on that, which is the point: if a calculation leaks the host timezone,
// these tests fail.

describe("isPlainDate", () => {
  it("accepts well-formed real dates", () => {
    expect(isPlainDate("2026-09-11")).toBe(true);
    expect(isPlainDate("2024-02-29")).toBe(true); // leap year
    expect(isPlainDate("2000-02-29")).toBe(true); // century leap year
  });

  it("rejects dates that do not exist", () => {
    expect(isPlainDate("2025-02-29")).toBe(false); // not a leap year
    expect(isPlainDate("1900-02-29")).toBe(false); // century non-leap year
    expect(isPlainDate("2025-04-31")).toBe(false);
    expect(isPlainDate("2025-13-01")).toBe(false);
    expect(isPlainDate("2025-00-10")).toBe(false);
    expect(isPlainDate("2025-01-32")).toBe(false);
  });

  it("rejects malformed input rather than coercing it", () => {
    expect(isPlainDate("9/11/2026")).toBe(false);
    expect(isPlainDate("2026-9-11")).toBe(false);
    expect(isPlainDate("2026-09-11T00:00:00Z")).toBe(false);
    expect(isPlainDate("")).toBe(false);
    expect(isPlainDate("tomorrow")).toBe(false);
    expect(isPlainDate(null)).toBe(false);
    expect(isPlainDate(undefined)).toBe(false);
    expect(isPlainDate(20260911)).toBe(false);
    expect(isPlainDate(new Date())).toBe(false);
  });
});

describe("toPlainDate", () => {
  it("throws on an invalid date and never substitutes today", () => {
    expect(() => toPlainDate("not-a-date")).toThrow(InvalidDateError);
    expect(() => toPlainDate("2025-02-30")).toThrow(InvalidDateError);
    expect(() => toPlainDate("")).toThrow(InvalidDateError);
  });
});

describe("date arithmetic", () => {
  it("adds and subtracts calendar days", () => {
    expect(addDays(toPlainDate("2026-09-11"), 1)).toBe("2026-09-12");
    expect(subtractDays(toPlainDate("2026-09-11"), 1)).toBe("2026-09-10");
  });

  it("crosses month and year boundaries", () => {
    expect(addDays(toPlainDate("2026-01-31"), 1)).toBe("2026-02-01");
    expect(addDays(toPlainDate("2026-12-31"), 1)).toBe("2027-01-01");
    expect(subtractDays(toPlainDate("2026-01-01"), 1)).toBe("2025-12-31");
    expect(subtractDays(toPlainDate("2026-03-01"), 1)).toBe("2026-02-28");
    expect(subtractDays(toPlainDate("2024-03-01"), 1)).toBe("2024-02-29");
  });

  it("is unaffected by daylight-saving transitions in any zone", () => {
    // The business zone has no DST, but calendar arithmetic must be immune to
    // it regardless — these are the 2026 US transition dates, and adding a day
    // across them must still add exactly one day.
    expect(addDays(toPlainDate("2026-03-07"), 1)).toBe("2026-03-08");
    expect(addDays(toPlainDate("2026-03-08"), 1)).toBe("2026-03-09");
    expect(addDays(toPlainDate("2026-10-31"), 1)).toBe("2026-11-01");
    expect(addDays(toPlainDate("2026-11-01"), 1)).toBe("2026-11-02");
    expect(differenceInDays(toPlainDate("2026-03-09"), toPlainDate("2026-03-07"))).toBe(2);
    expect(differenceInDays(toPlainDate("2026-11-02"), toPlainDate("2026-10-31"))).toBe(2);
  });

  it("measures signed day differences", () => {
    expect(differenceInDays(toPlainDate("2026-09-21"), toPlainDate("2026-09-11"))).toBe(10);
    expect(differenceInDays(toPlainDate("2026-09-11"), toPlainDate("2026-09-21"))).toBe(-10);
    expect(differenceInDays(toPlainDate("2026-09-11"), toPlainDate("2026-09-11"))).toBe(0);
  });

  it("sorts chronologically", () => {
    const dates = ["2026-10-02", "2026-09-30", "2027-01-01", "2026-01-05"].map(toPlainDate);
    expect([...dates].sort(comparePlainDates)).toEqual([
      "2026-01-05",
      "2026-09-30",
      "2026-10-02",
      "2027-01-01",
    ]);
  });
});

describe("dayOfWeek", () => {
  it("uses ISO numbering with Monday as 1", () => {
    // 2026-09-07 is a Monday.
    expect(dayOfWeek(toPlainDate("2026-09-07"))).toBe(Weekday.Monday);
    expect(dayOfWeek(toPlainDate("2026-09-11"))).toBe(Weekday.Friday);
    expect(dayOfWeek(toPlainDate("2026-09-12"))).toBe(Weekday.Saturday);
    expect(dayOfWeek(toPlainDate("2026-09-13"))).toBe(Weekday.Sunday);
  });

  it("identifies weekends", () => {
    expect(isWeekend(toPlainDate("2026-09-11"))).toBe(false);
    expect(isWeekend(toPlainDate("2026-09-12"))).toBe(true);
    expect(isWeekend(toPlainDate("2026-09-13"))).toBe(true);
    expect(isWeekend(toPlainDate("2026-09-14"))).toBe(false);
  });
});

describe("todayInTimeZone", () => {
  it("resolves the calendar date in the named zone, not the host zone", () => {
    // 2026-06-15T03:30:00Z is still 2026-06-14 in Chicago (CDT, UTC-5) even
    // though the host process is at UTC+14 where it is already 2026-06-15.
    const instant = new Date("2026-06-15T03:30:00Z");
    expect(todayInTimeZone("America/Chicago", instant)).toBe("2026-06-14");
    expect(todayInTimeZone("UTC", instant)).toBe("2026-06-15");
  });

  it("keeps one offset year-round — the business zone has no daylight saving", () => {
    // Venezuela Time is a fixed UTC-4. The same UTC wall-clock time must map to
    // the same local time in January and in July; a zone with DST would not.
    const winter = new Date("2026-01-15T03:30:00Z");
    const summer = new Date("2026-07-15T03:30:00Z");

    expect(todayInTimeZone(BUSINESS_TIME_ZONE, winter)).toBe("2026-01-14");
    expect(todayInTimeZone(BUSINESS_TIME_ZONE, summer)).toBe("2026-07-14");

    // For contrast, a DST zone does shift across the year.
    expect(todayInTimeZone("America/Chicago", winter)).toBe("2026-01-14");
    expect(todayInTimeZone("America/Chicago", summer)).toBe("2026-07-14");
  });

  it("rolls over exactly at business midnight", () => {
    // 2026-07-15T03:59:59Z = 23:59:59 on 2026-07-14 in Caracas (UTC-4).
    expect(businessToday(new Date("2026-07-15T03:59:59Z"))).toBe("2026-07-14");
    expect(businessToday(new Date("2026-07-15T04:00:00Z"))).toBe("2026-07-15");
  });
});

describe("database boundary", () => {
  it("round-trips through the UTC-midnight representation Prisma uses", () => {
    const date = toPlainDate("2026-09-11");
    const dbValue = dbDateFromPlainDate(date);

    expect(dbValue.toISOString()).toBe("2026-09-11T00:00:00.000Z");
    expect(plainDateFromDbDate(dbValue)).toBe("2026-09-11");
  });

  it("does not shift the day when the host timezone is ahead of UTC", () => {
    // The host is at UTC+14. Reading local components here would yield the
    // 12th; reading UTC components correctly yields the 11th.
    const dbValue = new Date("2026-09-11T00:00:00.000Z");
    expect(plainDateFromDbDate(dbValue)).toBe("2026-09-11");
  });

  it("rejects an invalid Date rather than producing a garbage day", () => {
    expect(() => plainDateFromDbDate(new Date("nonsense"))).toThrow(InvalidDateError);
  });
});

describe("formatting", () => {
  it("formats from parts so the day can never shift", () => {
    expect(formatPlainDate(toPlainDate("2026-09-11"))).toBe("Sep 11, 2026");
    expect(formatPlainDate(toPlainDate("2026-01-01"))).toBe("Jan 1, 2026");
  });
});
