import { describe, expect, it } from "vitest";
import {
  COMPLETION_MILESTONES,
  LOWEST_MILESTONE,
  MAX_SHIFT_SECONDS,
  milestoneReached,
} from "@/lib/domain/completion-milestones";

const HOUR = 3600;

const reached = (
  completedToday: number,
  shiftSeconds: number | null = 4 * HOUR,
  alreadyCelebrated = 0,
) => milestoneReached({ completedToday, shiftSeconds, alreadyCelebrated });

describe("crossing a milestone", () => {
  it("says nothing below the first target", () => {
    expect(reached(29)).toBeNull();
    expect(reached(0)).toBeNull();
  });

  it("fires exactly on the target", () => {
    expect(reached(30)?.count).toBe(30);
    expect(reached(45, 4 * HOUR, 30)?.count).toBe(45);
    expect(reached(60, 4 * HOUR, 45)?.count).toBe(60);
  });

  it("keeps firing between targets only if not already celebrated", () => {
    expect(reached(37, 4 * HOUR, 0)?.count).toBe(30);
    expect(reached(37, 4 * HOUR, 30)).toBeNull();
  });

  it("says nothing once the top target is behind them", () => {
    expect(reached(80, 4 * HOUR, 60)).toBeNull();
  });
});

describe("a jump past several targets", () => {
  it("celebrates only the highest, not one per target", () => {
    // A bulk action from 29 to 60 must not stack three overlays.
    const milestone = reached(60, 4 * HOUR, 0);
    expect(milestone?.count).toBe(60);
  });

  it("still only fires once when part of the way is already celebrated", () => {
    expect(reached(60, 4 * HOUR, 30)?.count).toBe(60);
  });
});

describe("the eight-hour shift rule", () => {
  it("celebrates a sprint", () => {
    expect(reached(30, 6 * HOUR)?.count).toBe(30);
  });

  it("celebrates right on the boundary", () => {
    expect(reached(30, MAX_SHIFT_SECONDS)?.count).toBe(30);
  });

  it("refuses a second past it", () => {
    // The achievement is the pace. Thirty over a twelve-hour day is a
    // different thing and deliberately not celebrated.
    expect(reached(30, MAX_SHIFT_SECONDS + 1)).toBeNull();
    expect(reached(60, 12 * HOUR)).toBeNull();
  });

  it("celebrates when the shift length cannot be known", () => {
    // Clockify off, or this person not linked. Refusing here would punish a
    // configuration gap rather than a slow day.
    expect(reached(30, null)?.count).toBe(30);
    expect(reached(60, null, 45)?.count).toBe(60);
  });
});

describe("the milestone table", () => {
  it("is ascending, which is what makes 'highest crossed' correct", () => {
    const counts = COMPLETION_MILESTONES.map((m) => m.count);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it("matches the requested targets", () => {
    expect(COMPLETION_MILESTONES.map((m) => m.count)).toEqual([30, 45, 60]);
  });

  it("carries a non-empty message with emoji for every target", () => {
    for (const milestone of COMPLETION_MILESTONES) {
      expect(milestone.message.length).toBeGreaterThan(10);
      expect(/\p{Extended_Pictographic}/u.test(milestone.message)).toBe(true);
    }
  });

  it("exposes the lowest target, so Clockify is only asked when it matters", () => {
    expect(LOWEST_MILESTONE).toBe(30);
  });
});
