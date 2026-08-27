/**
 * The bell: one row per thing one person needs to know about.
 *
 * Deliberately not a delivery mechanism. Nothing here sends email or posts to
 * Discord; it records that somebody should look at something, and the header
 * widget reads it back. Keeping it to that means a notification can never fail
 * halfway — there is no external service to be down, and no message that went
 * out describing a change that was then rolled back.
 *
 * Every write goes through `notify`, which drops self-notifications on the
 * floor. Being told about your own action is noise, and filtering it at each
 * call site is how one of them eventually forgets.
 */

import type { NotificationKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { ActorContext } from "@/lib/auth/actor";

/** How many the bell will show at once. */
export const NOTIFICATION_PAGE = 30;

/**
 * Anything older than this is swept, read or not.
 *
 * A notification is a prompt to act, and one that has sat for a month has
 * either been acted on elsewhere or is never going to be. Keeping them forever
 * turns the bell into a second, worse audit log.
 */
export const NOTIFICATION_RETENTION_DAYS = 30;

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  eventId: string;
  /** How the event reads in the list — enough to recognise without opening it. */
  eventLabel: string;
  actorName: string | null;
  actorColor: string | null;
  detail: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotifyInput {
  recipientIds: readonly string[];
  actorId: string;
  kind: NotificationKind;
  eventId: string;
  detail?: string | null;
}

/**
 * Records a notification for each recipient.
 *
 * Never notifies the actor about their own action, and never duplicates a
 * recipient. Accepts a transaction client so a notification lands in the same
 * transaction as the change it describes — a flag that was rolled back must not
 * leave a notification behind claiming it was raised.
 */
export async function notify(
  input: NotifyInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const recipients = [...new Set(input.recipientIds)].filter(
    (id) => id !== input.actorId,
  );
  if (recipients.length === 0) return 0;

  const created = await tx.notification.createMany({
    data: recipients.map((recipientId) => ({
      recipientId,
      actorId: input.actorId,
      kind: input.kind,
      eventId: input.eventId,
      detail: input.detail ?? null,
    })),
  });

  return created.count;
}

/** Everyone who should hear about a flag when the person who raised it is not a manager. */
export async function managerIds(
  tx: Prisma.TransactionClient = prisma,
): Promise<string[]> {
  const managers = await tx.user.findMany({
    where: { active: true, role: { in: ["ADMIN", "MANAGER"] } },
    select: { id: true },
  });
  return managers.map((manager) => manager.id);
}

/** How an event reads in the bell. Matches the label used elsewhere. */
function labelFor(event: {
  awayTeam: string | null;
  homeTeam: string | null;
  venue: string | null;
  eventType: { name: string; emoji: string | null };
}): string {
  const teams = [event.awayTeam, event.homeTeam].filter(Boolean).join(" @ ");
  const what = teams || event.venue || event.eventType.name;
  return `${event.eventType.emoji ? `${event.eventType.emoji} ` : ""}${what}`;
}

export async function listNotifications(
  actor: ActorContext,
  options: { unreadOnly?: boolean } = {},
): Promise<{ notifications: NotificationView[]; unreadCount: number }> {
  const recipientId = actor.effective.id;

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: {
        recipientId,
        ...(options.unreadOnly ? { readAt: null } : {}),
      },
      // Newest first, then id: two notifications created in the same
      // transaction share a timestamp, and a list that reorders itself between
      // polls moves the row under the cursor.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: NOTIFICATION_PAGE,
      select: {
        id: true,
        kind: true,
        eventId: true,
        detail: true,
        readAt: true,
        createdAt: true,
        actor: { select: { displayName: true, color: true } },
        event: {
          select: {
            awayTeam: true,
            homeTeam: true,
            venue: true,
            eventType: { select: { name: true, emoji: true } },
          },
        },
      },
    }),
    prisma.notification.count({ where: { recipientId, readAt: null } }),
  ]);

  return {
    notifications: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      eventId: row.eventId,
      eventLabel: labelFor(row.event),
      actorName: row.actor?.displayName ?? null,
      actorColor: row.actor?.color ?? null,
      detail: row.detail,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    unreadCount,
  };
}

/**
 * Marks notifications read.
 *
 * Scoped to the recipient in the `where` rather than checked first and updated
 * after: an id belonging to somebody else simply matches nothing, so there is
 * no window between the check and the write and no way to learn whether the id
 * existed.
 */
export async function markRead(
  actor: ActorContext,
  ids: readonly string[] | "ALL",
): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: {
      recipientId: actor.effective.id,
      readAt: null,
      ...(ids === "ALL" ? {} : { id: { in: [...ids] } }),
    },
    data: { readAt: new Date() },
  });
  return result.count;
}

/** Housekeeping. Safe to run as often as you like. */
export async function sweepOldNotifications(): Promise<number> {
  const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 86_400_000);
  const result = await prisma.notification.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}
