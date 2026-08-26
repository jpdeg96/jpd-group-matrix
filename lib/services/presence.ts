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
import { assertCanStartWork, type ActorContext } from "@/lib/auth/actor";
import { plainDateFromDbDate, type PlainDate } from "@/lib/date/plain-date";
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

export interface MyPresenceEntry {
  eventId: string;
  context: PresenceContextValue;
  startedAt: string;
  minutesActive: number;
  /** Enough of the event to name it in a banner on a screen that has no table. */
  label: string;
}

/**
 * Everything *this* user is currently marked as working on, across both screens.
 *
 * The per-screen `listPresence` cannot answer this: it is scoped to one context
 * and returns whoever is on each event. The shell banner needs the inverse —
 * what am I on, wherever I happen to be looking — so that a claim stays visible
 * after navigating away from the table that made it.
 */
export async function listMyPresence(actor: ActorContext): Promise<MyPresenceEntry[]> {
  const cutoff = await staleBefore();

  const rows = await prisma.presence.findMany({
    where: { userId: actor.effective.id, lastHeartbeat: { gte: cutoff } },
    select: {
      eventId: true,
      context: true,
      startedAt: true,
      event: {
        select: {
          eventDate: true,
          awayTeam: true,
          homeTeam: true,
          venue: true,
          eventType: { select: { name: true, emoji: true } },
        },
      },
    },
    orderBy: { startedAt: "asc" },
  });

  const now = Date.now();

  return rows.map((row) => {
    const teams = [row.event.awayTeam, row.event.homeTeam].filter(Boolean).join(" @ ");
    const emoji = row.event.eventType.emoji ? `${row.event.eventType.emoji} ` : "";
    const label = teams || row.event.venue || `${emoji}${row.event.eventType.name}`;

    return {
      eventId: row.eventId,
      context: row.context as PresenceContextValue,
      startedAt: row.startedAt.toISOString(),
      minutesActive: Math.floor((now - row.startedAt.getTime()) / 60_000),
      label: `${emoji}${label}`,
    };
  });
}

export interface TeamPresenceEntry {
  userId: string;
  userName: string;
  userColor: string;
  eventId: string;
  context: PresenceContextValue;
  startedAt: string;
  minutesActive: number;
  /** The event, named the way it reads on the table it came from. */
  label: string;
  /** Shown under the label, so two fixtures with the same teams are separable. */
  eventDate: PlainDate;
  venue: string | null;
}

/**
 * Everyone currently working, across both screens.
 *
 * Neither existing reader answers this. `listPresence` is scoped to one screen
 * and keyed by event — it can say who is on the rows in front of you, but not
 * that somebody is deep in C1 while you are looking at the Dashboard.
 * `listMyPresence` is the right shape and the wrong person.
 *
 * Ordered oldest claim first, because the entry worth noticing is the one that
 * has been open longest — a four-hour "in progress" is either a hard event or a
 * forgotten one, and both are worth a manager's attention before a fresh claim
 * is.
 *
 * Callers must check the role themselves; this is a plain read.
 */
export async function listTeamPresence(): Promise<TeamPresenceEntry[]> {
  const cutoff = await staleBefore();

  const rows = await prisma.presence.findMany({
    where: { lastHeartbeat: { gte: cutoff } },
    select: {
      eventId: true,
      context: true,
      startedAt: true,
      user: { select: { id: true, displayName: true, color: true } },
      event: {
        select: {
          eventDate: true,
          awayTeam: true,
          homeTeam: true,
          venue: true,
          eventType: { select: { name: true, emoji: true } },
        },
      },
    },
    // Oldest first, then the row id, so two claims made in the same millisecond
    // cannot swap places between polls and move a line under the cursor.
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
  });

  const now = Date.now();

  return rows.map((row) => {
    const teams = [row.event.awayTeam, row.event.homeTeam].filter(Boolean).join(" @ ");
    const emoji = row.event.eventType.emoji ? `${row.event.eventType.emoji} ` : "";
    const label = teams || row.event.venue || row.event.eventType.name;

    return {
      userId: row.user.id,
      userName: row.user.displayName,
      userColor: row.user.color,
      eventId: row.eventId,
      context: row.context as PresenceContextValue,
      startedAt: row.startedAt.toISOString(),
      minutesActive: Math.max(
        0,
        Math.floor((now - row.startedAt.getTime()) / 60_000),
      ),
      label: `${emoji}${label}`,
      eventDate: plainDateFromDbDate(row.event.eventDate),
      venue: teams ? row.event.venue : null,
    };
  });
}

/** Refreshes every claim this user holds, on every screen. */
export async function heartbeatAll(actor: ActorContext): Promise<number> {
  const result = await prisma.presence.updateMany({
    where: { userId: actor.effective.id },
    data: { lastHeartbeat: new Date() },
  });
  return result.count;
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
    select: { id: true, assigneeId: true },
  });
  if (!event) throw notFound("That event no longer exists.");

  assertCanStartWork(actor, event.assigneeId);

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
