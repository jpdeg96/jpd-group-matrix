/**
 * "In progress" presence.
 *
 * A user marks an event as being worked on and everyone else sees it, live.
 *
 * The critical design point is expiry. Presence is driven by a heartbeat and
 * anything that stops beating is dropped. Without that, one closed laptop
 * leaves an event flagged forever, and within a week nobody trusts the
 * indicator — which is worse than not having it.
 */

import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors";
import type { ActorContext } from "@/lib/auth/actor";
import { getSettings } from "./settings";

export type PresenceContextValue = "DASHBOARD" | "C1";

export interface PresenceEntry {
  eventId: string;
  userId: string;
  userName: string;
  userColor: string;
  startedAt: string;
  /** Whole minutes since they started, for the "working 4m" label. */
  minutesActive: number;
}

/** Presence rows older than this are treated as gone. */
async function staleBefore(): Promise<Date> {
  const settings = await getSettings();
  return new Date(Date.now() - settings.presenceTimeoutMinutes * 60_000);
}

/**
 * Live presence for a screen, keyed by event id.
 *
 * Expired rows are filtered out at read time rather than relied upon being
 * cleaned up, so a stale flag can never be displayed even if the sweeper has
 * not run recently.
 */
export async function listPresence(
  context: PresenceContextValue,
): Promise<Map<string, PresenceEntry[]>> {
  const cutoff = await staleBefore();

  const rows = await prisma.presence.findMany({
    where: { context, lastHeartbeat: { gte: cutoff } },
    select: {
      eventId: true,
      userId: true,
      startedAt: true,
      user: { select: { displayName: true, color: true } },
    },
    orderBy: { startedAt: "asc" },
  });

  const now = Date.now();
  const byEvent = new Map<string, PresenceEntry[]>();

  for (const row of rows) {
    const entry: PresenceEntry = {
      eventId: row.eventId,
      userId: row.userId,
      userName: row.user.displayName,
      userColor: row.user.color,
      startedAt: row.startedAt.toISOString(),
      minutesActive: Math.max(
        0,
        Math.floor((now - row.startedAt.getTime()) / 60_000),
      ),
    };

    const list = byEvent.get(row.eventId);
    if (list) list.push(entry);
    else byEvent.set(row.eventId, [entry]);
  }

  return byEvent;
}

/** Flat list, for the SSE payload. */
export async function listPresenceFlat(
  context: PresenceContextValue,
): Promise<PresenceEntry[]> {
  const byEvent = await listPresence(context);
  return [...byEvent.values()].flat();
}

/**
 * Marks an event as being worked on, or refreshes an existing claim.
 *
 * `startedAt` is preserved on refresh so the "working for 12m" label keeps
 * counting from when they actually began.
 */
export async function startPresence(
  eventId: string,
  context: PresenceContextValue,
  actor: ActorContext,
): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });
  if (!event) throw notFound("That event no longer exists.");

  const userId = actor.effective.id;
  const now = new Date();

  await prisma.presence.upsert({
    where: { userId_eventId_context: { userId, eventId, context } },
    update: { lastHeartbeat: now },
    create: { userId, eventId, context, startedAt: now, lastHeartbeat: now },
  });
}

/** Refreshes every claim this user holds. Called on the client's heartbeat. */
export async function heartbeat(
  actor: ActorContext,
  context: PresenceContextValue,
): Promise<void> {
  await prisma.presence.updateMany({
    where: { userId: actor.effective.id, context },
    data: { lastHeartbeat: new Date() },
  });
}

export async function stopPresence(
  eventId: string,
  context: PresenceContextValue,
  actor: ActorContext,
): Promise<void> {
  await prisma.presence.deleteMany({
    where: { userId: actor.effective.id, eventId, context },
  });
}

/** Drops every claim this user holds — used when they leave the page. */
export async function clearPresenceForUser(actor: ActorContext): Promise<void> {
  await prisma.presence.deleteMany({ where: { userId: actor.effective.id } });
}

/**
 * Deletes expired rows.
 *
 * Purely housekeeping: reads already filter by heartbeat, so this only stops
 * the table growing. Safe to run as often as you like.
 */
export async function sweepExpiredPresence(): Promise<number> {
  const cutoff = await staleBefore();
  const result = await prisma.presence.deleteMany({
    where: { lastHeartbeat: { lt: cutoff } },
  });
  return result.count;
}

/**
 * A cheap change signature for the SSE stream.
 *
 * Comparing this string tells the stream whether anything actually changed, so
 * a quiet system sends nothing rather than pushing identical payloads.
 */
export function presenceSignature(entries: PresenceEntry[]): string {
  return entries
    .map((entry) => `${entry.eventId}:${entry.userId}`)
    .sort()
    .join("|");
}
