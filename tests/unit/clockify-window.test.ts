/**
 * Clamping Clockify entries to the window being asked about.
 *
 * These are the two ways the previous total inflated. Both are reproduced here
 * against the old behaviour — "full duration of every entry returned" — so the
 * tests fail if anyone reverts to it.
 */

import { describe, expect, it } from "vitest";
import { secondsWithinWindow, sumSecondsWithinWindow } from "@/lib/clockify/duration";

const at = (iso: string) => new Date(iso);
const HOUR = 3600;

describe("a forgotten running timer", () => {
  // Started Friday morning, never stopped. It is now Monday.
  const forgotten = { start: "2026-08-14T09:00:00Z", duration: null };
  const monday = at("2026-08-17T09:00:00Z");

  it("contributes only the part inside the window, not three days", () => {
    // Friday alone. Counting to "now" would have credited 72 hours.
    const friday = { from: at("2026-08-14T00:00:00Z"), to: at("2026-08-15T00:00:00Z") };

    expect(secondsWithinWindow(forgotten, friday, monday)).toBe(15 * HOUR);
  });

  it("contributes nothing to a window it never touched", () => {
    // The week before it started. The old code added elapsed-time-to-now here
    // too, which is how a period that had already closed gained hours.
    const weekBefore = { from: at("2026-08-03T00:00:00Z"), to: at("2026-08-10T00:00:00Z") };

    expect(secondsWithinWindow(forgotten, weekBefore, monday)).toBe(0);
  });

  it("is counted up to now, not to the end of an open-ended window", () => {
    // "This week" runs to Saturday, but it is only Monday morning.
    const thisWeek = { from: at("2026-08-16T00:00:00Z"), to: at("2026-08-23T00:00:00Z") };

    // Midnight Sunday to 09:00 Monday is 33 hours, not the rest of the week.
    expect(secondsWithinWindow(forgotten, thisWeek, monday)).toBe(33 * HOUR);
  });
});

describe("an entry that straddles a boundary", () => {
  // A shift from 23:00 to 01:00 the next day.
  const overnight = { start: "2026-08-16T23:00:00Z", duration: "PT2H" };
  const now = at("2026-08-18T12:00:00Z");

  const sunday = { from: at("2026-08-16T00:00:00Z"), to: at("2026-08-17T00:00:00Z") };
  const monday = { from: at("2026-08-17T00:00:00Z"), to: at("2026-08-18T00:00:00Z") };

  it("gives each day only its own share", () => {
    expect(secondsWithinWindow(overnight, sunday, now)).toBe(1 * HOUR);
    expect(secondsWithinWindow(overnight, monday, now)).toBe(1 * HOUR);
  });

  it("adds up to the whole entry across both days, never more", () => {
    // Two hours worked is two hours reported — the old behaviour reported four.
    const total =
      secondsWithinWindow(overnight, sunday, now) + secondsWithinWindow(overnight, monday, now);

    expect(total).toBe(2 * HOUR);
  });
});

describe("ordinary entries", () => {
  const now = at("2026-08-17T18:00:00Z");
  const window = { from: at("2026-08-17T00:00:00Z"), to: at("2026-08-18T00:00:00Z") };

  it("counts one wholly inside the window in full", () => {
    expect(
      secondsWithinWindow({ start: "2026-08-17T09:00:00Z", duration: "PT7H30M" }, window, now),
    ).toBe(7 * HOUR + 1800);
  });

  it("counts nothing for one wholly outside", () => {
    expect(
      secondsWithinWindow({ start: "2026-08-12T09:00:00Z", duration: "PT8H" }, window, now),
    ).toBe(0);
  });

  it("ignores an entry whose start will not parse rather than returning NaN", () => {
    expect(secondsWithinWindow({ start: "not a date", duration: "PT1H" }, window, now)).toBe(0);
  });

  it("treats a zero-length entry as zero", () => {
    expect(
      secondsWithinWindow({ start: "2026-08-17T09:00:00Z", duration: "PT0S" }, window, now),
    ).toBe(0);
  });
});

describe("summing a day", () => {
  const now = at("2026-08-17T18:00:00Z");
  const today = { from: at("2026-08-17T00:00:00Z"), to: at("2026-08-18T00:00:00Z") };

  it("adds only what happened today, across a realistic mix", () => {
    const entries = [
      // Ran into today from last night: 1 hour of it is today's.
      { start: "2026-08-16T23:00:00Z", duration: "PT2H" },
      // A normal morning.
      { start: "2026-08-17T09:00:00Z", duration: "PT3H" },
      // Still running since 14:00, so four hours so far.
      { start: "2026-08-17T14:00:00Z", duration: null },
      // Yesterday entirely.
      { start: "2026-08-16T09:00:00Z", duration: "PT8H" },
    ];

    expect(sumSecondsWithinWindow(entries, today, now)).toBe(8 * HOUR);
  });

  it("is zero for no entries rather than NaN", () => {
    expect(sumSecondsWithinWindow([], today, now)).toBe(0);
  });
});
