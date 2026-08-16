/**
 * The two notifications nothing else triggers: a release going out, and
 * Clockify changing state.
 *
 * Both run from the hourly maintenance job rather than at startup. Startup is
 * the wrong moment for either — a restart is not a release, and two instances
 * booting would announce the same one twice. A scheduled check that compares
 * against stored state is idempotent by construction, which is what makes it
 * safe to run as often as it likes.
 */

import { prisma } from "@/lib/db/prisma";
import { ANNOUNCEMENTS, type Announcement } from "@/lib/domain/announcements";
import { getSettings, invalidateSettingsCache, SETTINGS_ID } from "@/lib/services/settings";
import { getWorkspaceUsers, isClockifyConfigured } from "@/lib/clockify/client";
import { notify } from "./discord";
import { clockifyHealthMessage, releaseMessage } from "./messages";

/** At most this many entries are listed individually before it becomes a count. */
const MAX_LISTED = 5;

/**
 * Announcements newer than the last one posted.
 *
 * `ANNOUNCEMENTS` is newest-first and its ids are never reused, so "newer" is
 * everything above the last-seen id. An id that is not in the list at all —
 * a rollback, or a hand-edited row — yields the whole list rather than
 * nothing, because saying too much once is better than going silent forever.
 */
export function releasesSince(
  announcements: readonly Announcement[],
  lastId: string | null,
): Announcement[] {
  if (!lastId) return [];
  const index = announcements.findIndex((entry) => entry.id === lastId);
  return index === -1 ? [...announcements] : announcements.slice(0, index);
}

/**
 * Posts anything released since the last check.
 *
 * The first ever run posts nothing and simply records where it is. Announcing
 * the entire history the moment notifications are switched on would bury the
 * channel and tell nobody anything.
 */
export async function announceNewReleases(): Promise<{ posted: number }> {
  const settings = await getSettings();
  const newest = ANNOUNCEMENTS[0];

  if (!settings.discordEnabled || !newest) return { posted: 0 };

  const pending = releasesSince(ANNOUNCEMENTS, settings.discordLastReleaseId);

  // Record first, post second. A crash between the two costs one notification;
  // the other order costs a duplicate on every retry until it succeeds.
  if (settings.discordLastReleaseId !== newest.id) {
    await prisma.settings.update({
      where: { id: SETTINGS_ID },
      data: { discordLastReleaseId: newest.id },
    });
    invalidateSettingsCache();
  }

  if (pending.length === 0) return { posted: 0 };

  await notify(releaseMessage(pending.slice(0, MAX_LISTED)));
  return { posted: pending.length };
}

/**
 * Probes Clockify and posts only when the answer differs from last time.
 *
 * It calls the raw workspace-users endpoint rather than one of the service
 * helpers, because those catch their own errors and return an empty result —
 * which makes a quiet workspace and a dead API look identical. Health needs the
 * throw.
 */
export async function checkClockifyHealth(): Promise<{ healthy: boolean; changed: boolean }> {
  const settings = await getSettings();

  if (!settings.clockifyEnabled || !settings.clockifyWorkspaceId || !isClockifyConfigured()) {
    return { healthy: true, changed: false };
  }

  let healthy = true;
  let detail: string | null = null;

  try {
    await getWorkspaceUsers(settings.clockifyWorkspaceId);
  } catch (error) {
    healthy = false;
    detail = error instanceof Error ? error.message : "Clockify did not respond.";
  }

  const previous = settings.clockifyHealthy;
  const changed = previous !== null && previous !== healthy;

  await prisma.settings.update({
    where: { id: SETTINGS_ID },
    data: { clockifyHealthy: healthy, clockifyHealthCheckedAt: new Date() },
  });
  invalidateSettingsCache();

  // A first observation is not a change. Announcing "Clockify is down" the
  // first time this ever runs would be reporting the state of the world, not
  // an event.
  if (changed && settings.discordEnabled) {
    await notify(clockifyHealthMessage(healthy, detail));
  }

  return { healthy, changed };
}
