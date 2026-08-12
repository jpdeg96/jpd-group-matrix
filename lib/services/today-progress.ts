/**
 * How much this person has done today, for the completion milestones.
 *
 * Kept separate from the metrics service on purpose: that one answers questions
 * about everybody over an arbitrary window and is far too heavy to run on every
 * tick of a checkbox. This is two cheap reads on the hot path.
 */

import { prisma } from "@/lib/db/prisma";
import type { ActorContext } from "@/lib/auth/actor";
import { businessToday, getSettings } from "./settings";
import { getClockifySummary, startOfBusinessDay } from "./clockify";
import { LOWEST_MILESTONE } from "@/lib/domain/completion-milestones";

export interface TodayProgress {
  /** Events this person ticked Complete on today. */
  completedToday: number;
  /** Seconds worked today, or null when Clockify cannot tell us. */
  shiftSeconds: number | null;
}

export async function getTodayProgress(actor: ActorContext): Promise<TodayProgress> {
  const settings = await getSettings();
  const today = await businessToday();
  const dayStart = startOfBusinessDay(today, settings.timeZone);

  // Attributed to whoever ticked the box, not to the assignee — the same rule
  // the Metrics page uses, so the two can never disagree.
  const completedToday = await prisma.event.count({
    where: {
      completedById: actor.effective.id,
      completedAt: { gte: dayStart },
    },
  });

  // Clockify costs real API calls, so it is only worth asking once a
  // celebration is actually in play. Below the first milestone the shift
  // length cannot change the answer.
  if (completedToday < LOWEST_MILESTONE) {
    return { completedToday, shiftSeconds: null };
  }

  try {
    const summary = await getClockifySummary(actor.effective.id);
    const known = summary.enabled && !summary.error && summary.linked;
    return { completedToday, shiftSeconds: known ? summary.todaySeconds : null };
  } catch {
    // Never let a timekeeping outage swallow the completion count.
    return { completedToday, shiftSeconds: null };
  }
}
