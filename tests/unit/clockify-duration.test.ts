import { describe, expect, it } from "vitest";
import {
  formatDurationClock,
  formatDurationShort,
  parseIsoDurationSeconds,
  secondsSince,
} from "@/lib/clockify/duration";

describe("parseIsoDurationSeconds", () => {
  it("parses the shapes Clockify returns", () => {
    expect(parseIsoDurationSeconds("PT1H30M")).toBe(5400);
    expect(parseIsoDurationSeconds("PT45M")).toBe(2700);
    expect(parseIsoDurationSeconds("PT30S")).toBe(30);
    expect(parseIsoDurationSeconds("PT8H")).toBe(28800);
    expect(parseIsoDurationSeconds("PT1H30M15S")).toBe(5415);
  });

  it("handles day components from a timer left running overnight", () => {
    expect(parseIsoDurationSeconds("P1DT2H")).toBe(93600);
    expect(parseIsoDurationSeconds("P2D")).toBe(172800);
  });

  it("treats a running entry as zero rather than NaN", () => {
    // A running timer has no duration yet; one bad entry must not poison a
    // whole day's total.
    expect(parseIsoDurationSeconds(null)).toBe(0);
    expect(parseIsoDurationSeconds(undefined)).toBe(0);
    expect(parseIsoDurationSeconds("")).toBe(0);
    expect(parseIsoDurationSeconds("garbage")).toBe(0);
    expect(parseIsoDurationSeconds("1:30")).toBe(0);
  });

  it("rounds fractional seconds", () => {
    expect(parseIsoDurationSeconds("PT1.5M")).toBe(90);
  });

  it("never returns a negative", () => {
    expect(parseIsoDurationSeconds("PT-5M")).toBe(0);
  });
});

describe("formatting", () => {
  it("formats a compact summary", () => {
    expect(formatDurationShort(0)).toBe("0m");
    expect(formatDurationShort(59)).toBe("0m");
    expect(formatDurationShort(60)).toBe("1m");
    expect(formatDurationShort(3600)).toBe("1h");
    expect(formatDurationShort(3660)).toBe("1h 1m");
    expect(formatDurationShort(28_800)).toBe("8h");
  });

  it("formats a clock reading", () => {
    expect(formatDurationClock(0)).toBe("0:00");
    expect(formatDurationClock(3660)).toBe("1:01");
    expect(formatDurationClock(36_000)).toBe("10:00");
  });

  it("clamps negatives instead of rendering nonsense", () => {
    expect(formatDurationShort(-100)).toBe("0m");
    expect(formatDurationClock(-100)).toBe("0:00");
  });
});

describe("secondsSince", () => {
  it("measures elapsed time from an ISO instant", () => {
    const now = new Date("2026-08-09T12:00:00Z");
    expect(secondsSince("2026-08-09T11:00:00Z", now)).toBe(3600);
  });

  it("returns zero for a future start, so clock skew cannot go negative", () => {
    const now = new Date("2026-08-09T12:00:00Z");
    expect(secondsSince("2026-08-09T12:05:00Z", now)).toBe(0);
  });

  it("returns zero for an unparseable instant", () => {
    expect(secondsSince("not-a-date")).toBe(0);
  });
});
