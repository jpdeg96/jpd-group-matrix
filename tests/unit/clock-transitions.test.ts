import { describe, expect, it } from "vitest";
import {
  describeClockChange,
  diffClockSnapshots,
  snapshotFrom,
  type ClockReading,
} from "@/lib/domain/clock-transitions";

const reading = (over: Partial<ClockReading> = {}): ClockReading => ({
  error: null,
  linked: true,
  runningSeconds: null,
  clockedIn: [],
  ...over,
});

const dana = { userId: "u-dana", displayName: "Dana Whitfield" };
const marco = { userId: "u-marco", displayName: "Marco Ruiz" };
const priya = { userId: "u-priya", displayName: "Priya Raman" };

const diff = (before: ClockReading | null, next: ClockReading) =>
  diffClockSnapshots(before ? snapshotFrom(before) : null, snapshotFrom(next), {
    linked: next.linked,
  });

describe("the first reading", () => {
  it("only establishes a baseline", () => {
    // Otherwise opening the app announces everyone already on the clock.
    const first = reading({ runningSeconds: 120, clockedIn: [dana, marco] });
    expect(diff(null, first)).toMatchObject({
      self: null,
      arrived: [],
      departed: [],
    });
  });
});

describe("the viewer's own timer", () => {
  it("reports clocking in", () => {
    const before = reading({ runningSeconds: null });
    const after = reading({ runningSeconds: 5 });
    expect(diff(before, after).self).toBe("in");
  });

  it("reports clocking out", () => {
    expect(diff(reading({ runningSeconds: 900 }), reading({ runningSeconds: null })).self).toBe(
      "out",
    );
  });

  it("says nothing while the timer merely runs on", () => {
    expect(diff(reading({ runningSeconds: 60 }), reading({ runningSeconds: 90 })).self).toBeNull();
  });

  it("says nothing while still clocked out", () => {
    expect(diff(reading(), reading()).self).toBeNull();
  });

  it("stays silent for an account with no Clockify user linked", () => {
    // An unlinked viewer never has a timer, so any apparent change is an
    // artefact rather than something that happened.
    const before = reading({ linked: false, runningSeconds: null });
    const after = reading({ linked: false, runningSeconds: 30 });
    expect(diff(before, after).self).toBeNull();
  });
});

describe("other people", () => {
  it("notices someone starting a timer", () => {
    const changes = diff(reading(), reading({ clockedIn: [dana] }));
    expect(changes.arrived).toEqual(["Dana Whitfield"]);
    expect(changes.departed).toEqual([]);
  });

  it("notices someone stopping one", () => {
    const changes = diff(reading({ clockedIn: [dana] }), reading());
    expect(changes.departed).toEqual(["Dana Whitfield"]);
    expect(changes.arrived).toEqual([]);
  });

  it("reports an arrival and a departure in the same poll", () => {
    const changes = diff(reading({ clockedIn: [dana] }), reading({ clockedIn: [marco] }));
    expect(changes.arrived).toEqual(["Marco Ruiz"]);
    expect(changes.departed).toEqual(["Dana Whitfield"]);
  });

  it("says nothing about someone who simply stayed on the clock", () => {
    const changes = diff(reading({ clockedIn: [dana] }), reading({ clockedIn: [dana] }));
    expect(changes.arrived).toEqual([]);
    expect(changes.departed).toEqual([]);
  });

  it("sorts the de-duplication ids so they are stable regardless of order", () => {
    const a = diff(reading(), reading({ clockedIn: [priya, dana, marco] }));
    const b = diff(reading(), reading({ clockedIn: [dana, marco, priya] }));
    expect(a.arrivedIds).toEqual(b.arrivedIds);
    expect(a.arrivedIds).toEqual(["u-dana", "u-marco", "u-priya"]);
  });

  it("tracks people by id, not by name", () => {
    // Two people can share a display name; renaming one is not a clock event.
    const before = reading({ clockedIn: [{ userId: "u-1", displayName: "Sam" }] });
    const after = reading({ clockedIn: [{ userId: "u-1", displayName: "Samantha" }] });
    const changes = diff(before, after);
    expect(changes.arrived).toEqual([]);
    expect(changes.departed).toEqual([]);
  });
});

describe("describeClockChange", () => {
  it("names one person", () => {
    expect(describeClockChange(["Dana Whitfield"], "clocked in")).toBe(
      "Dana Whitfield clocked in.",
    );
  });

  it("names two", () => {
    expect(describeClockChange(["Dana", "Marco"], "clocked out")).toBe(
      "Dana and Marco clocked out.",
    );
  });

  it("counts three or more rather than listing them", () => {
    expect(describeClockChange(["Dana", "Marco", "Priya"], "clocked in")).toBe(
      "3 people clocked in.",
    );
  });
});
