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
