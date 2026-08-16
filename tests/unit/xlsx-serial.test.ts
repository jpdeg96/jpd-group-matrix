/**
 * The date-serial conversion in the .xlsx reader.
 *
 * This is the one piece of that reader capable of failing silently: a wrong
 * epoch shifts every date in the migration by a day or more, and unbounded
 * output puts a 1907 completion timestamp in the database. Both are worth a
 * test even though the reader itself is used once.
 */

import { describe, expect, it } from "vitest";
import { serialToDate, serialToPlainDate } from "@/lib/import/xlsx";

describe("serialToDate", () => {
  it("reads a whole-day serial as midnight UTC", () => {
    expect(serialToDate(46249)?.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("keeps the time component of a fractional serial", () => {
    // .5 of a day is exactly midday.
    expect(serialToDate(46249.5)?.toISOString()).toBe("2026-08-15T12:00:00.000Z");
  });

  it("counts consecutive serials as consecutive days", () => {
    expect(serialToDate(46250)?.toISOString().slice(0, 10)).toBe("2026-08-16");
  });

  it("accepts the whole plausible range and nothing outside it", () => {
    // The source spreadsheet holds a handful of 1900s values that are
    // corruption rather than dates; letting them through would date a
    // completion to 1907.
    expect(serialToDate(36526)?.toISOString().slice(0, 10)).toBe("2000-01-01");
    expect(serialToDate(73415)?.toISOString().slice(0, 10)).toBe("2100-12-31");
    expect(serialToDate(36525)).toBeNull(); // 1999-12-31
    expect(serialToDate(73416)).toBeNull(); // 2101-01-01
    expect(serialToDate(2)).toBeNull(); // 1900-01-01
    expect(serialToDate(3000)).toBeNull(); // 1908-03-18
  });

  it("rejects nonsense rather than returning an Invalid Date", () => {
    expect(serialToDate(Number.NaN)).toBeNull();
    expect(serialToDate(0)).toBeNull();
    expect(serialToDate(-5)).toBeNull();
    expect(serialToDate(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("serialToPlainDate", () => {
  it("drops the time component rather than rounding into the next day", () => {
    // 23:59 on the 15th is still the 15th.
    expect(serialToPlainDate(46249.999)).toBe("2026-08-15");
    expect(serialToPlainDate(46249)).toBe("2026-08-15");
  });

  it("is null for a serial outside the plausible range", () => {
    expect(serialToPlainDate(2)).toBeNull();
  });
});
