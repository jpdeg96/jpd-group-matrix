/**
 * Noticing that somebody clocked in or out.
 *
 * Clocking happens in Clockify, not here, so there is no event to hook — the
 * only way to know is to ask, and to compare the answer with the last one. That
 * comparison is what `clock_status` holds; without it every poll would either
 * announce everybody currently on the clock or announce nothing at all.
 *
 * This runs server-side on purpose. The header chip already notices the same
 * transitions, but only in an open browser tab, which is exactly where nobody
 * is at seven in the morning when the first person starts.
 */

import { prisma } from "@/lib/db/prisma";
import { getSettings } from "@/lib/services/settings";
import { getRunningEntry, isClockifyConfigured } from "@/lib/clockify/client";
import { isPushConfigured, sendPush } from "@/lib/services/push";

export interface ClockTransition {
  userId: string;
  displayName: string;
  kind: "IN" | "OUT";
  at: Date;
}

/**
 * Whoever should hear about somebody's shift starting.
 *
 * Two gates, and they answer different questions. The permission is whether
 * this role is told at all, which is a manager's decision about a job; the
 * per-user flag is whether this person's own phone buzzes, which is theirs.
 * Somebody supervising a shift they are not working may reasonably want the
 * first without the second.
 *
 * The person who clocked in is never told about themselves — they are holding
 * the phone that did it.
 */
async function audienceFor(subjectId: string): Promise<string[]> {
  const candidates = await prisma.user.findMany({
    where: {
      active: true,
      pushClockEvents: true,
      id: { not: subjectId },
      roleRef: { permissions: { some: { permission: "clock.notify" } } },
    },
    select: { id: true },
  });

  return candidates.map((row) => row.id);
}

/**
 * Ask Clockify who is on the clock, and report what changed since last time.
 *
 * Returns the transitions it saw, so the HTTP endpoint can report them and the
 * tests can assert on them without reaching into push.
 */
export async function pollClockStatus(
  now: Date = new Date(),
): Promise<{ checked: number; transitions: ClockTransition[]; skipped: string | null }> {
  const none = { checked: 0, transitions: [] as ClockTransition[] };

  const settings = await getSettings();
  if (!settings.clockifyEnabled || !settings.clockifyWorkspaceId) {
    return { ...none, skipped: "clockify-disabled" };
  }
  if (!isClockifyConfigured()) {
    return { ...none, skipped: "clockify-unconfigured" };
  }

  const workspaceId = settings.clockifyWorkspaceId;

  const linked = await prisma.user.findMany({
    where: { active: true, clockifyUserId: { not: null } },
    select: { id: true, displayName: true, clockifyUserId: true },
  });
  if (linked.length === 0) return { ...none, skipped: "nobody-linked" };

  const previous = new Map(
    (
      await prisma.clockStatus.findMany({
        where: { userId: { in: linked.map((user) => user.id) } },
        select: { userId: true, running: true, startedAt: true },
      })
    ).map((row) => [row.userId, row]),
  );

  const transitions: ClockTransition[] = [];
  let checked = 0;

  /*
   * Sequentially rather than in parallel.
   *
   * This is a background job on a minute's cadence with no one waiting on it,
   * and Clockify's rate limit is per API key — firing a dozen simultaneous
   * requests every minute to save two seconds nobody is counting is how a
   * background job gets the whole workspace throttled, including the header
   * chip that people actually watch.
   */
  for (const user of linked) {
    let entry;
    try {
      entry = await getRunningEntry(workspaceId, user.clockifyUserId!);
    } catch {
      // Leave this person's stored state untouched. Recording "not running"
      // because the API was unreachable would fire a clock-out that never
      // happened, and then a clock-in when it came back.
      continue;
    }

    checked += 1;

    const running = entry !== null;
    const startedAt = entry ? new Date(entry.timeInterval.start) : null;
    const before = previous.get(user.id);

    await prisma.clockStatus.upsert({
      where: { userId: user.id },
      create: { userId: user.id, running, startedAt, checkedAt: now },
      update: { running, startedAt, checkedAt: now },
    });

    // Nothing known about them yet. Record where they are and say nothing:
    // the first poll after a deploy must not announce everybody who happens
    // to be working as though they had all just arrived.
    if (!before) continue;

    if (!before.running && running) {
      transitions.push({
        userId: user.id,
        displayName: user.displayName,
        kind: "IN",
        at: startedAt ?? now,
      });
      continue;
    }

    if (before.running && !running) {
      transitions.push({
        userId: user.id,
        displayName: user.displayName,
        kind: "OUT",
        at: now,
      });
      continue;
    }

    /*
     * Still running, but it is a different entry than last time.
     *
     * Somebody stopped and started again between two polls — a break, or
     * switching what they are working on. `running` is true at both ends, so
     * the plain comparison above sees nothing. Reported as a clock-in, which
     * is the half that matters: they are on the clock now, and a pair of
     * notifications for a thirty-second gap would be noise.
     */
    if (
      running &&
      before.running &&
      startedAt &&
      before.startedAt &&
      startedAt.getTime() !== before.startedAt.getTime()
    ) {
      transitions.push({
        userId: user.id,
        displayName: user.displayName,
        kind: "IN",
        at: startedAt,
      });
    }
  }

  return { checked, transitions, skipped: null };
}

/**
 * Poll, then push whatever changed.
 *
 * Push failures are swallowed inside `sendPush`, so a push service having a bad
 * minute never stops the next poll from running or corrupts the stored state —
 * which has already been written by the time anything is sent.
 */
export async function runClockWatch(
  now: Date = new Date(),
): Promise<{ checked: number; transitions: number; pushed: number; skipped: string | null }> {
  const result = await pollClockStatus(now);
  if (result.transitions.length === 0 || !isPushConfigured()) {
    return {
      checked: result.checked,
      transitions: result.transitions.length,
      pushed: 0,
      skipped: result.skipped,
    };
  }

  let pushed = 0;

  for (const transition of result.transitions) {
    const audience = await audienceFor(transition.userId);
    if (audience.length === 0) continue;

    const outcome = await sendPush(audience, {
      title: `${transition.displayName} clocked ${transition.kind === "IN" ? "in" : "out"}`,
      body:
        transition.kind === "IN"
          ? "Started a timer in Clockify."
          : "Stopped their timer in Clockify.",
      url: "/team",
      // Per person rather than per event, so a morning of one person stopping
      // and starting collapses instead of stacking.
      tag: `clock:${transition.userId}`,
      kind: `CLOCK_${transition.kind}`,
    });

    pushed += outcome.sent;
  }

  return {
    checked: result.checked,
    transitions: result.transitions.length,
    pushed,
    skipped: result.skipped,
  };
}
