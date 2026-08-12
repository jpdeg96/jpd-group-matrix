/**
 * Detecting clock-in and clock-out from successive Clockify readings.
 *
 * Clocking in happens *in Clockify*, not in this application, so there is no
 * event to subscribe to — the only way to know is to notice that the answer
 * changed between two polls. This module is that comparison, kept pure so it
 * can be tested without a browser, a timer or a Clockify account.
 *
 * The React side (`components/shell/use-clock-notifications.ts`) supplies the
 * readings and turns the result into toasts.
 */

/** The fields a reading must carry. A superset is fine. */
export interface ClockReading {
  /** Non-null when the reading failed; such a reading must not be diffed. */
  error: string | null;
  /** Whether the viewer's own account is linked to a Clockify user at all. */
  linked: boolean;
  /** Seconds on the viewer's running timer, or null when clocked out. */
  runningSeconds: number | null;
  /** Everyone on the clock *except* the viewer. */
  clockedIn: ReadonlyArray<{ userId: string; displayName: string }>;
}

export interface ClockSnapshot {
  selfRunning: boolean;
  /** userId → display name. */
  others: ReadonlyMap<string, string>;
}

export interface ClockTransitions {
  /** "in" or "out" when the viewer's own state changed, else null. */
  self: "in" | "out" | null;
  /** Display names of people who started a timer since the previous reading. */
  arrived: string[];
  /** Display names of people who stopped one. */
  departed: string[];
  /** Ids behind `arrived`, sorted — a stable identity for de-duplication. */
  arrivedIds: string[];
  /** Ids behind `departed`, sorted. */
  departedIds: string[];
}

export const NO_TRANSITIONS: ClockTransitions = {
  self: null,
  arrived: [],
  departed: [],
  arrivedIds: [],
  departedIds: [],
};

export function snapshotFrom(reading: ClockReading): ClockSnapshot {
  return {
    selfRunning: reading.runningSeconds !== null,
    others: new Map(reading.clockedIn.map((entry) => [entry.userId, entry.displayName])),
  };
}

/**
 * What changed between two readings.
 *
 * `before` being null means this is the first good reading of the session: it
 * establishes a baseline and reports nothing, because otherwise opening the app
 * would announce everyone who already happened to be on the clock.
 */
export function diffClockSnapshots(
  before: ClockSnapshot | null,
  next: ClockSnapshot,
  options: { linked: boolean },
): ClockTransitions {
  if (!before) return NO_TRANSITIONS;

  // An unlinked viewer has no timer of their own, so `selfRunning` is always
  // false and a change in it could only ever be an artefact.
  const self =
    options.linked && next.selfRunning !== before.selfRunning
      ? next.selfRunning
        ? ("in" as const)
        : ("out" as const)
      : null;

  const arrivedIds: string[] = [];
  const arrived: string[] = [];
  for (const [id, name] of next.others) {
    if (!before.others.has(id)) {
      arrivedIds.push(id);
      arrived.push(name);
    }
  }

  const departedIds: string[] = [];
  const departed: string[] = [];
  for (const [id, name] of before.others) {
    if (!next.others.has(id)) {
      departedIds.push(id);
      departed.push(name);
    }
  }

  return {
    self,
    arrived,
    departed,
    arrivedIds: [...arrivedIds].sort(),
    departedIds: [...departedIds].sort(),
  };
}

/**
 * "Dana clocked in." / "Dana and Marco clocked in." / "3 people clocked in."
 *
 * Names are dropped past two: a toast listing five people is read as a wall of
 * text and dismissed, where a count is read.
 */
export function describeClockChange(names: readonly string[], verb: string): string {
  if (names.length === 1) return `${names[0]} ${verb}.`;
  if (names.length === 2) return `${names[0]} and ${names[1]} ${verb}.`;
  return `${names.length} people ${verb}.`;
}
