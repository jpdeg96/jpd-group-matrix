/**
 * Reading the audit trail.
 *
 * Writing lives in `audit.ts`; this is the query side that backs the Audit Log
 * screen. Manager-and-above only — it exposes who did what across every event,
 * which is exactly the information a regular user should not be browsing.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { AuditEntityType } from "./audit";

export interface AuditLogEntry {
  id: string;
  createdAt: string;
  actorName: string;
  actorColor: string;
  /** Set when the action was taken while viewing as somebody else. */
  impersonatedName: string | null;
  entityType: string;
  entityId: string;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  /** Resolved label for the affected event, when the entity is one. */
  subject: string | null;
}

export interface AuditLogFilters {
  entityType?: AuditEntityType;
  userId?: string;
  action?: string;
  search?: string;
  /** Page size. Bounded so a huge log cannot be pulled in one request. */
  limit?: number;
  cursor?: string;
}

const MAX_LIMIT = 200;

export async function listAuditLog(filters: AuditLogFilters = {}): Promise<{
  entries: AuditLogEntry[];
  nextCursor: string | null;
}> {
  const limit = Math.min(filters.limit ?? 100, MAX_LIMIT);

  const where: Prisma.AuditLogWhereInput = {};
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.userId) where.userId = filters.userId;
  if (filters.action) where.action = filters.action;

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    // Fetch one extra to discover whether another page exists without a count.
    take: limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      createdAt: true,
      entityType: true,
      entityId: true,
      action: true,
      oldValue: true,
      newValue: true,
      impersonatedUserId: true,
      user: { select: { displayName: true, color: true } },
    },
  });

  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? (page.at(-1)?.id ?? null) : null;

  // Resolve the human-readable subject for event rows in one extra query rather
  // than a join per entry.
  const eventIds = page
    .filter((row) => row.entityType === "EVENT")
    .map((row) => row.entityId);

  const events =
    eventIds.length > 0
      ? await prisma.event.findMany({
          where: { id: { in: eventIds } },
          select: { id: true, awayTeam: true, homeTeam: true, eventType: { select: { name: true } } },
        })
      : [];

  const subjects = new Map(
    events.map((event) => [
      event.id,
      [event.awayTeam, event.homeTeam].filter(Boolean).join(" at ") ||
        event.eventType.name,
    ]),
  );

  const impersonatedIds = page
    .map((row) => row.impersonatedUserId)
    .filter((id): id is string => id !== null);

  const impersonated =
    impersonatedIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: impersonatedIds } },
          select: { id: true, displayName: true },
        })
      : [];

  const impersonatedNames = new Map(
    impersonated.map((user) => [user.id, user.displayName]),
  );

  const entries = page.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    // A null actor is the scheduler; a deleted one still has their actions.
    actorName: row.user?.displayName ?? "System",
    actorColor: row.user?.color ?? "#64748b",
    impersonatedName: row.impersonatedUserId
      ? (impersonatedNames.get(row.impersonatedUserId) ?? "Unknown user")
      : null,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    oldValue: row.oldValue,
    newValue: row.newValue,
    subject: subjects.get(row.entityId) ?? null,
  }));

  // Free-text search runs over the resolved entries rather than in SQL: the
  // interesting text lives inside JSON columns, and matching there is both
  // slower and harder to get right than filtering a bounded page.
  const needle = filters.search?.trim().toLowerCase();
  const filtered = needle
    ? entries.filter((entry) =>
        [entry.actorName, entry.action, entry.entityType, entry.subject]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(needle)),
      )
    : entries;

  return { entries: filtered, nextCursor };
}

/** Distinct actions present in the log, for the filter dropdown. */
export async function listAuditActions(): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
  });
  return rows.map((row) => row.action);
}
