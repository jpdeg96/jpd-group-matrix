import { describe, expect, it } from "vitest";
import {
  addDays,
  dayOfWeek,
  formatWeekday,
  toPlainDate,
  Weekday,
  type PlainDate,
} from "@/lib/date/plain-date";
import {
  adjustWeekendDueDate,
  buildReviewSchedule,
  calculateRawReviewDue,
  calculateReviewDue,
  classifyDueUrgency,
  currentStage,
  calendarDaysSince,
  elapsedDaysSince,
  daysUntilDue,
  isStaleCompletion,
  STALE_COMPLETION_DAYS,
  describeDueDate,
  endOfWeek,
  isDashboardEventOverdueForStaging,
  isStaleDashboardEvent,
  isWithinRange,
  resolveDueRange,
  stageProgress,
  stageScheduleDrift,
  startOfWeek,
  type ScheduleConfig,
} from "@/lib/domain/review-schedule";
import {
  DEFAULT_REVIEW_OFFSETS,
  normaliseReviewOffsets,
  reviewStageLabel,
} from "@/lib/domain/constants";

const d = (value: string): PlainDate => toPlainDate(value);

const DEFAULT_CONFIG: ScheduleConfig = {
  offsets: [...DEFAULT_REVIEW_OFFSETS],
  weekendAdjustment: true,
};

/* -------------------------------------------------------------------------- */
/* Weekend adjustment                                                         */
/* -------------------------------------------------------------------------- */

describe("adjustWeekendDueDate", () => {
  // Anchor week: 2026-09-07 (Mon) … 2026-09-13 (Sun).
  it("leaves Monday through Friday untouched", () => {
    expect(adjustWeekendDueDate(d("2026-09-07"))).toBe("2026-09-07");
    expect(adjustWeekendDueDate(d("2026-09-11"))).toBe("2026-09-11");
  });

  it("moves Saturday back to the preceding Friday", () => {
    expect(adjustWeekendDueDate(d("2026-09-12"))).toBe("2026-09-11");
  });

  it("moves Sunday back to the preceding Friday", () => {
    expect(adjustWeekendDueDate(d("2026-09-13"))).toBe("2026-09-11");
  });

  it("always lands on a weekday, for every day of a full year", () => {
    let cursor = d("2026-01-01");
    for (let i = 0; i < 365; i += 1) {
      const adjusted = adjustWeekendDueDate(cursor);
      expect(dayOfWeek(adjusted)).not.toBe(Weekday.Saturday);
      expect(dayOfWeek(adjusted)).not.toBe(Weekday.Sunday);
      // Never moves a deadline later, and never by more than two days.
      expect(daysUntilDue(adjusted, cursor)).toBeLessThanOrEqual(0);
      expect(daysUntilDue(adjusted, cursor)).toBeGreaterThanOrEqual(-2);
      cursor = addDays(cursor, 1);
    }
  });

  it("is idempotent", () => {
    for (const date of ["2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"]) {
      const once = adjustWeekendDueDate(d(date));
      expect(adjustWeekendDueDate(once)).toBe(once);
    }
  });

  it("does not adjust for public holidays", () => {
    // 2026-12-25 is a Friday — a weekday, so the rule leaves it alone by design.
    expect(formatWeekday(d("2026-12-25"))).toBe("Friday");
    expect(adjustWeekendDueDate(d("2026-12-25"))).toBe("2026-12-25");
  });
});

/* -------------------------------------------------------------------------- */
/* Review due                                                                 */
/* -------------------------------------------------------------------------- */

describe("calculateReviewDue", () => {
  it("subtracts the offset before applying the weekend rule", () => {
    // Event Thu 2026-10-01. D-21 = Thu 2026-09-10, already a weekday.
    expect(calculateRawReviewDue(d("2026-10-01"), 21)).toBe("2026-09-10");
    expect(calculateReviewDue(d("2026-10-01"), 21, DEFAULT_CONFIG)).toBe("2026-09-10");
  });

  it("pulls a Saturday deadline back to Friday", () => {
    // Event Sat 2026-10-03. D-21 = Sat 2026-09-12 → Fri 2026-09-11.
    expect(calculateReviewDue(d("2026-10-03"), 21, DEFAULT_CONFIG)).toBe("2026-09-11");
  });

  it("pulls a Sunday deadline back to Friday", () => {
    expect(calculateReviewDue(d("2026-10-04"), 21, DEFAULT_CONFIG)).toBe("2026-09-11");
  });

  it("leaves weekends alone when the rule is switched off", () => {
    const off: ScheduleConfig = { ...DEFAULT_CONFIG, weekendAdjustment: false };
    expect(calculateReviewDue(d("2026-10-03"), 21, off)).toBe("2026-09-12");
    expect(calculateReviewDue(d("2026-10-04"), 21, off)).toBe("2026-09-13");
  });

  it("never returns a weekend for any configured offset across a full year", () => {
    let eventDate = d("2026-01-01");
    for (let i = 0; i < 365; i += 1) {
      for (const offset of DEFAULT_REVIEW_OFFSETS) {
        const due = calculateReviewDue(eventDate, offset, DEFAULT_CONFIG);
        expect(dayOfWeek(due)).not.toBe(Weekday.Saturday);
        expect(dayOfWeek(due)).not.toBe(Weekday.Sunday);
      }
      eventDate = addDays(eventDate, 1);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Schedule building                                                          */
/* -------------------------------------------------------------------------- */

describe("buildReviewSchedule", () => {
  const today = d("2026-08-10");

  it("produces one entry per configured offset, furthest out first", () => {
    const schedule = buildReviewSchedule(d("2026-10-01"), today, DEFAULT_CONFIG);
    expect(schedule.map((entry) => entry.offsetDays)).toEqual([21, 14, 7, 5, 1]);
    expect(schedule.map((entry) => reviewStageLabel(entry.offsetDays))).toEqual([
      "D-21",
      "D-14",
      "D-7",
      "D-5",
      "D-1",
    ]);
  });

  it("honours a custom offset set from Settings", () => {
    const custom: ScheduleConfig = { offsets: [30, 10, 3], weekendAdjustment: true };
    const schedule = buildReviewSchedule(d("2026-10-01"), today, custom);
    expect(schedule.map((entry) => entry.offsetDays)).toEqual([30, 10, 3]);
  });

  it("keeps both stages when the weekend rule collapses two due dates", () => {
    // An event on a Friday: D-7 lands on the previous Friday, and D-5 on the
    // Sunday after it, which moves back onto that same Friday.
    const eventDate = d("2026-10-02");
    expect(formatWeekday(eventDate)).toBe("Friday");

    const schedule = buildReviewSchedule(eventDate, today, DEFAULT_CONFIG);
    const byOffset = new Map(
      schedule.map((entry) => [entry.offsetDays, entry.reviewDue]),
    );

    expect(byOffset.get(7)).toBe("2026-09-25");
    expect(byOffset.get(5)).toBe("2026-09-25");

    // A shared due date must never collapse two stages into one.
    expect(schedule).toHaveLength(5);
    expect(new Set(schedule.map((entry) => entry.offsetDays)).size).toBe(5);
    expect(new Set(schedule.map((entry) => entry.reviewDue)).size).toBe(4);
  });

  it("flags stages already past at promotion rather than dropping them", () => {
    // Completed 10 days before the event: D-21 and D-14 are already historical.
    const eventDate = d("2026-08-20");
    const schedule = buildReviewSchedule(eventDate, today, DEFAULT_CONFIG);

    expect(schedule).toHaveLength(5);

    const past = schedule.filter((entry) => entry.alreadyPast);
    const actionable = schedule.filter((entry) => !entry.alreadyPast);

    expect(past.map((entry) => entry.offsetDays)).toEqual([21, 14]);
    expect(actionable.map((entry) => entry.offsetDays)).toEqual([7, 5, 1]);
  });
});

/* -------------------------------------------------------------------------- */
/* Current stage                                                              */
/* -------------------------------------------------------------------------- */

describe("currentStage", () => {
  const stages = [
    { offsetDays: 21, status: "DONE" },
    { offsetDays: 14, status: "DONE" },
    { offsetDays: 7, status: "PENDING" },
    { offsetDays: 5, status: "PENDING" },
    { offsetDays: 1, status: "PENDING" },
  ];

  it("returns the furthest-out stage that is still pending", () => {
    expect(currentStage(stages)?.offsetDays).toBe(7);
  });

  it("skips stages that were never actionable", () => {
    const withSkipped = [
      { offsetDays: 21, status: "SKIPPED" },
      { offsetDays: 14, status: "SKIPPED" },
      { offsetDays: 7, status: "PENDING" },
    ];
    expect(currentStage(withSkipped)?.offsetDays).toBe(7);
  });

  it("returns null when every stage is resolved — the event leaves C1", () => {
    expect(currentStage(stages.map((s) => ({ ...s, status: "DONE" })))).toBeNull();
  });

  it("advances to the next stage as each is completed", () => {
    let working = [...stages];
    expect(currentStage(working)?.offsetDays).toBe(7);

    working = working.map((s) => (s.offsetDays === 7 ? { ...s, status: "DONE" } : s));
    expect(currentStage(working)?.offsetDays).toBe(5);

    working = working.map((s) => (s.offsetDays === 5 ? { ...s, status: "DONE" } : s));
    expect(currentStage(working)?.offsetDays).toBe(1);

    working = working.map((s) => (s.offsetDays === 1 ? { ...s, status: "DONE" } : s));
    expect(currentStage(working)).toBeNull();
  });

  it("counts resolved stages for the progress indicator", () => {
    expect(stageProgress(stages)).toEqual({ resolved: 2, total: 5 });
  });
});

/* -------------------------------------------------------------------------- */
/* Schedule drift                                                             */
/* -------------------------------------------------------------------------- */

describe("stageScheduleDrift", () => {
  // Event Thu 2026-10-01: D-7 falls on Thu 2026-09-24.
  const eventDate = d("2026-10-01");

  const pending = {
    offsetDays: 7,
    reviewDue: d("2026-09-24"),
    reviewDueOverridden: false,
    status: "PENDING",
  };

  it("reports no drift when the stored date matches the schedule", () => {
    const result = stageScheduleDrift(pending, eventDate, DEFAULT_CONFIG);
    expect(result.expected).toBe("2026-09-24");
    expect(result.drifted).toBe(false);
  });

  it("reports drift once the event date moves", () => {
    // Event pushed back a week; D-7 should now be 2026-10-01.
    const result = stageScheduleDrift(pending, d("2026-10-08"), DEFAULT_CONFIG);
    expect(result.expected).toBe("2026-10-01");
    expect(result.drifted).toBe(true);
  });

  it("never reports drift on a hand-set date", () => {
    // Marking a date manual is the act of opting out of the formula; flagging
    // it afterwards would argue with a decision already made.
    const manual = { ...pending, reviewDueOverridden: true };
    const result = stageScheduleDrift(manual, d("2026-10-08"), DEFAULT_CONFIG);
    expect(result.expected).toBe("2026-10-01");
    expect(result.drifted).toBe(false);
  });

  it("never reports drift on a resolved stage", () => {
    // A completed review happened when it happened.
    for (const status of ["DONE", "SKIPPED"]) {
      const resolved = { ...pending, status };
      expect(stageScheduleDrift(resolved, d("2026-10-08"), DEFAULT_CONFIG).drifted).toBe(
        false,
      );
    }
  });

  it("still applies the weekend rule to the expected date", () => {
    // Event Sat 2026-10-10 → D-7 lands Sat 2026-10-03 → pulled back to Fri.
    const result = stageScheduleDrift(pending, d("2026-10-10"), DEFAULT_CONFIG);
    expect(result.expected).toBe("2026-10-02");
    expect(formatWeekday(result.expected)).toBe("Friday");
  });

  it("always reports the expected date, drifted or not", () => {
    // The UI shows it either way, so it must never be conditional.
    expect(stageScheduleDrift(pending, eventDate, DEFAULT_CONFIG).expected).toBe(
      "2026-09-24",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Offset normalisation                                                       */
/* -------------------------------------------------------------------------- */

describe("normaliseReviewOffsets", () => {
  it("sorts descending, dedupes and drops nonsense", () => {
    expect(normaliseReviewOffsets([7, 21, 7, 14, 0, -5, 1, 5])).toEqual([
      21, 14, 7, 5, 1,
    ]);
  });

  it("rejects values beyond the sane horizon", () => {
    expect(normaliseReviewOffsets([400, 21])).toEqual([21]);
  });

  it("truncates fractional values rather than accepting them", () => {
    expect(normaliseReviewOffsets([7.9])).toEqual([7]);
  });
});

/* -------------------------------------------------------------------------- */
/* Dashboard flags                                                            */
/* -------------------------------------------------------------------------- */

describe("dashboard flags", () => {
  const today = d("2026-08-10");

  it("flags a past-dated event that was never completed", () => {
    expect(isStaleDashboardEvent(d("2026-08-09"), today, false)).toBe(true);
    expect(isStaleDashboardEvent(today, today, false)).toBe(false);
    // Completed events have left the dashboard, so they are never stale.
    expect(isStaleDashboardEvent(d("2026-08-09"), today, true)).toBe(false);
  });

  it("flags an event already inside its first review window", () => {
    // D-21 for an event 10 days out is well in the past.
    expect(
      isDashboardEventOverdueForStaging(d("2026-08-20"), today, false, DEFAULT_CONFIG),
    ).toBe(true);

    // An event 60 days out has not reached its first checkpoint.
    expect(
      isDashboardEventOverdueForStaging(d("2026-10-09"), today, false, DEFAULT_CONFIG),
    ).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Date-range shortcuts                                                       */
/* -------------------------------------------------------------------------- */

describe("due-date shortcuts", () => {
  // 2026-08-12 is a Wednesday.
  const wednesday = d("2026-08-12");

  // The business week runs Sunday to Saturday.
  it("finds the Sunday and Saturday of the containing week", () => {
    expect(startOfWeek(wednesday)).toBe("2026-08-09");
    expect(endOfWeek(wednesday)).toBe("2026-08-15");
  });

  it("treats Sunday and Saturday as the ends of the same week", () => {
    expect(startOfWeek(d("2026-08-09"))).toBe("2026-08-09");
    expect(startOfWeek(d("2026-08-15"))).toBe("2026-08-09");
    expect(endOfWeek(d("2026-08-09"))).toBe("2026-08-15");
  });

  it("puts Sunday at the start of its own week, not the end of the previous one", () => {
    // The boundary the change turns on: under a Monday-start week this Sunday
    // belonged to the week that had just finished.
    expect(startOfWeek(d("2026-08-16"))).toBe("2026-08-16");
    expect(endOfWeek(d("2026-08-16"))).toBe("2026-08-22");
  });

  it("keeps Saturday in the week that began the previous Sunday", () => {
    expect(startOfWeek(d("2026-08-15"))).toBe("2026-08-09");
  });

  it("resolves Today to a single day", () => {
    expect(resolveDueRange("TODAY", wednesday)).toEqual({
      from: "2026-08-12",
      to: "2026-08-12",
    });
  });

  it("runs This week from today, not from the start of the week", () => {
    // A "what's left this week?" filter should not resurface passed deadlines.
    expect(resolveDueRange("THIS_WEEK", wednesday)).toEqual({
      from: "2026-08-12",
      to: "2026-08-15",
    });
  });

  it("resolves Next week to the following Sunday–Saturday", () => {
    expect(resolveDueRange("NEXT_WEEK", wednesday)).toEqual({
      from: "2026-08-16",
      to: "2026-08-22",
    });
  });

  it("keeps Next week correct when today is already Saturday", () => {
    // Saturday closes the week, so next week is the one starting tomorrow.
    expect(resolveDueRange("NEXT_WEEK", d("2026-08-15"))).toEqual({
      from: "2026-08-16",
      to: "2026-08-22",
    });
  });

  it("keeps Next week correct when today is Sunday, which opens a week", () => {
    expect(resolveDueRange("NEXT_WEEK", d("2026-08-16"))).toEqual({
      from: "2026-08-23",
      to: "2026-08-29",
    });
  });

  it("crosses a month boundary without gaps", () => {
    const range = resolveDueRange("NEXT_WEEK", d("2026-08-27"));
    expect(range).toEqual({ from: "2026-08-30", to: "2026-09-05" });
  });

  it("tests range membership inclusively at both ends", () => {
    const range = resolveDueRange("THIS_WEEK", wednesday);
    expect(isWithinRange(d("2026-08-12"), range)).toBe(true);
    expect(isWithinRange(d("2026-08-15"), range)).toBe(true);
    expect(isWithinRange(d("2026-08-11"), range)).toBe(false);
    expect(isWithinRange(d("2026-08-16"), range)).toBe(false);
  });

  it("leaves no gap between This week and Next week", () => {
    const thisWeek = resolveDueRange("THIS_WEEK", wednesday);
    const nextWeek = resolveDueRange("NEXT_WEEK", wednesday);
    expect(addDays(thisWeek.to, 1)).toBe(nextWeek.from);
  });
});

/* -------------------------------------------------------------------------- */
/* Completion staleness                                                       */
/* -------------------------------------------------------------------------- */

describe("completion staleness", () => {
  const now = new Date("2026-08-09T12:00:00Z");

  it("measures elapsed 24-hour periods, which is not a day count", () => {
    // Kept, and named for what it is. It was being used as a calendar-day
    // count, which is how 23:00 yesterday came to read as "today" — see
    // `calendarDaysSince` below for the one the screens use.
    expect(elapsedDaysSince("2026-08-09T11:00:00Z", now)).toBe(0);
    expect(elapsedDaysSince("2026-08-08T11:00:00Z", now)).toBe(1);
    expect(elapsedDaysSince("2026-07-10T12:00:00Z", now)).toBe(30);
  });

  it("shows exactly the flaw that made it wrong for dates", () => {
    // Finished at 23:00, read at 08:00 the next morning: nine hours elapsed,
    // so zero periods — but it was unambiguously yesterday.
    expect(elapsedDaysSince("2026-08-09T03:00:00Z", new Date("2026-08-09T12:00:00Z"))).toBe(0);
    expect(calendarDaysSince(d("2026-08-08"), d("2026-08-09"))).toBe(1);
  });

  it("returns null when nothing was ever completed", () => {
    expect(elapsedDaysSince(null, now)).toBeNull();
    expect(elapsedDaysSince("nonsense", now)).toBeNull();
  });

  it("counts calendar days, so last night is yesterday and not today", () => {
    // The bug this replaced measured elapsed 24-hour periods. Something
    // finished at 23:00 and looked at nine hours later was zero periods old,
    // so the dashboard called it "today" when it was plainly yesterday.
    expect(calendarDaysSince(d("2026-08-09"), d("2026-08-10"))).toBe(1);
    expect(calendarDaysSince(d("2026-08-10"), d("2026-08-10"))).toBe(0);
    expect(calendarDaysSince(d("2026-07-11"), d("2026-08-10"))).toBe(30);
  });

  it("clamps a future date to zero rather than going negative", () => {
    expect(calendarDaysSince(d("2026-08-12"), d("2026-08-10"))).toBe(0);
  });

  it("is null when there is no completion to measure", () => {
    expect(calendarDaysSince(null, d("2026-08-10"))).toBeNull();
  });

  it("flags a completion at or past the threshold", () => {
    expect(isStaleCompletion(d("2026-07-11"), d("2026-08-10"))).toBe(true); // exactly 30
    expect(isStaleCompletion(d("2026-06-01"), d("2026-08-10"))).toBe(true);
  });

  it("does not flag a recent completion", () => {
    expect(isStaleCompletion(d("2026-07-12"), d("2026-08-10"))).toBe(false); // 29 days
    expect(isStaleCompletion(d("2026-08-09"), d("2026-08-10"))).toBe(false);
  });

  it("never flags an event that was never completed", () => {
    // Uncompleted work is surfaced by other means; treating a null as "very
    // old" would flood the filter with everything that has not started.
    expect(isStaleCompletion(null, d("2026-08-10"))).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(isStaleCompletion(d("2026-08-03"), d("2026-08-10"), 7)).toBe(true);
    expect(isStaleCompletion(d("2026-08-04"), d("2026-08-10"), 7)).toBe(false);
  });

  it("defaults to 30 days", () => {
    expect(STALE_COMPLETION_DAYS).toBe(30);
  });
});

/* -------------------------------------------------------------------------- */
/* Urgency                                                                    */
/* -------------------------------------------------------------------------- */

describe("due-date urgency", () => {
  const today = d("2026-08-10");

  it("classifies the operational bands", () => {
    expect(classifyDueUrgency(d("2026-08-09"), today)).toBe("OVERDUE");
    expect(classifyDueUrgency(d("2026-08-10"), today)).toBe("TODAY");
    expect(classifyDueUrgency(d("2026-08-11"), today)).toBe("TOMORROW");
    expect(classifyDueUrgency(d("2026-08-13"), today)).toBe("SOON");
    expect(classifyDueUrgency(d("2026-08-25"), today)).toBe("SCHEDULED");
  });

  it("describes due dates in plain language", () => {
    expect(describeDueDate(d("2026-08-10"), today)).toBe("Due today");
    expect(describeDueDate(d("2026-08-11"), today)).toBe("Due tomorrow");
    expect(describeDueDate(d("2026-08-12"), today)).toBe("Due in 2 days");
    expect(describeDueDate(d("2026-08-09"), today)).toBe("1 day overdue");
    expect(describeDueDate(d("2026-08-07"), today)).toBe("3 days overdue");
  });
});
