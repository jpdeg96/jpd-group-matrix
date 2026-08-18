/**
 * ISO-8601 duration handling for Clockify.
 *
 * Pure and separate from the HTTP client so the parsing — which is the part
 * that silently gets numbers wrong — is directly testable.
 */

/**
 * Parses an ISO-8601 duration into seconds.
 *
 * Clockify returns time-only durations such as `PT1H30M15S`, and `null` while a
 * timer is still running. Anything unparseable yields 0 rather than NaN: a
 * malformed entry should not poison a whole day's total.
 *
 * Date components (`P1D`) are handled too, since a forgotten running timer can
 * be closed out days later.
 */
export function parseIsoDurationSeconds(duration: string | null | undefined): number {
  if (!duration) return 0;

  const match =
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      duration.trim().toUpperCase(),
    );

  if (!match) return 0;

  const [, days, hours, minutes, seconds] = match;
  const total =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);

  return Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0;
}

/** `3675` → `1h 1m`. Compact enough for a header chip. */
export function formatDurationShort(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);

  if (hours === 0 && minutes === 0) return "0m";
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/** `3675` → `1:01`. For a live-ticking timer. */
export function formatDurationClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

/** Seconds elapsed since an ISO instant. Never negative, even with clock skew. */
export function secondsSince(iso: string, now: Date = new Date()): number {
  const started = new Date(iso).getTime();
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.round((now.getTime() - started) / 1000));
}

/** The shape this needs off a Clockify entry. */
export interface TimedEntry {
  start: string;
  /** ISO-8601 duration, or null while the timer is still running. */
  duration: string | null;
}

/**
 * How much of an entry actually falls inside a window.
 *
 * ## Why this is not just "add up the durations"
 *
 * Two ways that over-counts, both of which produced hours nobody had worked:
 *
 * A **running timer** has no duration, so its length is "until now". Somebody
 * who forgets to clock out on Friday still has a timer running on Monday, and
 * counting it to `now` credited three days of elapsed wall-clock to whatever
 * period the query asked about — including periods that had already ended. That
 * is the inflation: not a rounding drift but a weekend added to a week.
 *
 * An entry that **straddles a boundary** counted in full on both sides. A shift
 * running from 23:00 to 01:00 was two hours of "today" and two hours of
 * "tomorrow", so a week of late finishes quietly gained hours that were real
 * but counted twice.
 *
 * Both disappear if the question is asked properly: not "how long was this
 * entry" but "how much of it happened during the window". An entry entirely
 * outside contributes nothing; one that overlaps contributes exactly its
 * overlap.
 *
 * `now` bounds the answer as well as `to`, because a window may extend into the
 * future — "this week" on a Tuesday — and no one has worked Thursday yet.
 */
export function secondsWithinWindow(
  entry: TimedEntry,
  window: { from: Date; to: Date },
  now: Date = new Date(),
): number {
  const started = new Date(entry.start).getTime();
  if (Number.isNaN(started)) return 0;

  const nowMs = now.getTime();

  const finished =
    entry.duration === null
      ? // Still running: it has lasted until now, and no further.
        nowMs
      : started + parseIsoDurationSeconds(entry.duration) * 1000;

  const from = window.from.getTime();
  const to = Math.min(window.to.getTime(), nowMs);

  const overlapStart = Math.max(started, from);
  const overlapEnd = Math.min(finished, to);

  if (overlapEnd <= overlapStart) return 0;

  return Math.round((overlapEnd - overlapStart) / 1000);
}

/** Total seconds worked inside a window, across many entries. */
export function sumSecondsWithinWindow(
  entries: readonly TimedEntry[],
  window: { from: Date; to: Date },
  now: Date = new Date(),
): number {
  return entries.reduce((total, entry) => total + secondsWithinWindow(entry, window, now), 0);
}
