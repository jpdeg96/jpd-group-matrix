import { describe, expect, it } from "vitest";
import { toPlainDate, type PlainDate } from "@/lib/date/plain-date";
import {
  daysInRange,
  endOfMonth,
  isMetricsPeriod,
  METRICS_PERIODS,
  resolveMetricsPeriod,
  startOfMonth,
} from "@/lib/domain/metrics-period";

const d = (value: string): PlainDate => toPlainDate(value);

// 2026-08-12 is a Wednesday.
const wednesday = d("2026-08-12");

describe("month boundaries", () => {
  it("finds the first and last day of a month", () => {
    expect(startOfMonth(wednesday)).toBe("2026-08-01");
    expect(endOfMonth(wednesday)).toBe("2026-08-31");
  });

  it("gets 30-day months right", () => {
    expect(endOfMonth(d("2026-09-15"))).toBe("2026-09-30");
  });

  it("gets February right in a common year and a leap year", () => {
    expect(endOfMonth(d("2026-02-10"))).toBe("2026-02-28");
    expect(endOfMonth(d("2028-02-10"))).toBe("2028-02-29");
  });

  it("rolls over the year end", () => {
    expect(endOfMonth(d("2026-12-05"))).toBe("2026-12-31");
    expect(startOfMonth(d("2026-01-31"))).toBe("2026-01-01");
  });
});

describe("resolveMetricsPeriod", () => {
  it("resolves single-day periods", () => {
    expect(resolveMetricsPeriod("TODAY", wednesday)).toMatchObject({
      from: "2026-08-12",
      to: "2026-08-12",
    });
    expect(resolveMetricsPeriod("YESTERDAY", wednesday)).toMatchObject({
      from: "2026-08-11",
      to: "2026-08-11",
    });
  });

  it("ends in-progress periods at today, not at the end of the unit", () => {
    // Otherwise every average would be dragged down by days that have not
    // happened yet.
    expect(resolveMetricsPeriod("THIS_WEEK", wednesday)).toMatchObject({
      from: "2026-08-10",
      to: "2026-08-12",
    });
    expect(resolveMetricsPeriod("THIS_MONTH", wednesday)).toMatchObject({
      from: "2026-08-01",
      to: "2026-08-12",
    });
    expect(resolveMetricsPeriod("YTD", wednesday)).toMatchObject({
      from: "2026-01-01",
      to: "2026-08-12",
    });
  });

  it("resolves completed periods to their full span", () => {
    expect(resolveMetricsPeriod("LAST_WEEK", wednesday)).toMatchObject({
      from: "2026-08-03",
      to: "2026-08-09",
    });
    expect(resolveMetricsPeriod("LAST_MONTH", wednesday)).toMatchObject({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("has no lower bound for all-time", () => {
    const range = resolveMetricsPeriod("ALL_TIME", wednesday);
    expect(range.from).toBeNull();
    expect(range.to).toBe("2026-08-12");
  });

  it("keeps last week correct when today is Monday", () => {
    // The boundary case: Monday is the first day of its own week, so last week
    // must be the seven days immediately before it.
    expect(resolveMetricsPeriod("LAST_WEEK", d("2026-08-10"))).toMatchObject({
      from: "2026-08-03",
      to: "2026-08-09",
    });
  });

  it("keeps last month correct on the first of a month", () => {
    expect(resolveMetricsPeriod("LAST_MONTH", d("2026-08-01"))).toMatchObject({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("crosses the year boundary for last month in January", () => {
    expect(resolveMetricsPeriod("LAST_MONTH", d("2026-01-15"))).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("leaves no gap between last week and this week", () => {
    const last = resolveMetricsPeriod("LAST_WEEK", wednesday);
    const current = resolveMetricsPeriod("THIS_WEEK", wednesday);
    expect(last.to).toBe("2026-08-09");
    expect(current.from).toBe("2026-08-10");
  });

  it("labels every period", () => {
    for (const period of METRICS_PERIODS) {
      expect(resolveMetricsPeriod(period, wednesday).label.length).toBeGreaterThan(0);
    }
  });
});

describe("daysInRange", () => {
  it("enumerates an inclusive range", () => {
    const range = resolveMetricsPeriod("THIS_WEEK", wednesday);
    expect(daysInRange(range)).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
  });

  it("returns a single day for today", () => {
    expect(daysInRange(resolveMetricsPeriod("TODAY", wednesday))).toEqual([
      "2026-08-12",
    ]);
  });

  it("returns nothing for an unbounded range", () => {
    // All-time has no start, so a daily series would be meaningless.
    expect(daysInRange(resolveMetricsPeriod("ALL_TIME", wednesday))).toEqual([]);
  });

  it("caps long ranges so a chart cannot try to draw thousands of columns", () => {
    const range = resolveMetricsPeriod("YTD", d("2026-12-31"));
    expect(daysInRange(range, 120)).toHaveLength(120);
  });
});

describe("isMetricsPeriod", () => {
  it("accepts known periods and rejects anything else", () => {
    expect(isMetricsPeriod("THIS_WEEK")).toBe(true);
    expect(isMetricsPeriod("LAST_DECADE")).toBe(false);
    expect(isMetricsPeriod(null)).toBe(false);
    expect(isMetricsPeriod(7)).toBe(false);
  });
});
