/**
 * Event types (formerly "leagues").
 *
 * Administrator-managed records rather than free text, so the dashboard filter
 * is a closed list and typos cannot silently create a new category.
 *
 * Types are deactivated, never deleted, while events still reference them —
 * the foreign key is `onDelete: Restrict` so the database refuses to orphan an
 * event even if the service layer were bypassed.
 */

import { prisma } from "@/lib/db/prisma";
import { conflict, isUniqueViolation, notFound, validationError } from "@/lib/errors";
import { recordAudit } from "./audit";

export interface EventTypeView {
  id: string;
  name: string;
  emoji: string | null;
  active: boolean;
  sortOrder: number;
  eventCount: number;
}

/**
 * Sensible default emoji for common type names.
 *
 * Applied only when a type is created without one, so an administrator's own
 * choice is never overwritten. Matching is loose because people write "NBA",
 * "Basketball" and "NBA Basketball" interchangeably.
 */
const DEFAULT_EMOJI: Array<[RegExp, string]> = [
  [/\bnba\b|basketball/i, "🏀"],
  [/\bnfl\b|\bncaaf\b|football/i, "🏈"],
  [/\bnhl\b|hockey/i, "🏒"],
  [/\bmlb\b|baseball/i, "⚾"],
  [/\bmls\b|soccer|f[uú]tbol/i, "⚽"],
  [/tennis|\batp\b|\bwta\b/i, "🎾"],
  [/golf|\bpga\b/i, "⛳"],
  [/boxing|\bufc\b|\bmma\b/i, "🥊"],
  [/racing|nascar|formula|\bf1\b/i, "🏎️"],
  [/concert|music|tour|festival/i, "🎵"],
  [/theat|musical|broadway|opera/i, "🎭"],
  [/comedy|stand.?up/i, "🎤"],
  [/family|circus|ice show/i, "🎪"],
];

export function suggestEmoji(name: string): string | null {
  for (const [pattern, emoji] of DEFAULT_EMOJI) {
    if (pattern.test(name)) return emoji;
  }
  return null;
}

/** Types offered when creating an event — active only. */
export async function listActiveEventTypes() {
  return prisma.eventType.findMany({
    where: { active: true },
    select: { id: true, name: true, emoji: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/**
 * Every type, with usage counts, for the Settings screen.
 *
 * Inactive types are included so an administrator can see and reactivate them,
 * and so a type still attached to historical events remains visible.
 */
export async function listEventTypes(): Promise<EventTypeView[]> {
  const rows = await prisma.eventType.findMany({
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      emoji: true,
      active: true,
      sortOrder: true,
      _count: { select: { events: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    active: row.active,
    sortOrder: row.sortOrder,
    eventCount: row._count.events,
  }));
}

export async function createEventType(
  input: { name: string; emoji?: string | null; sortOrder?: number },
  actorUserId: string,
) {
  const name = input.name.trim();
  if (!name) throw validationError("Type name is required.");

  try {
    const created = await prisma.eventType.create({
      data: {
        name,
        // Suggest one only when none was given, so a deliberate choice — or a
        // deliberate blank — is never overwritten.
        emoji: input.emoji !== undefined ? input.emoji : suggestEmoji(name),
        sortOrder: input.sortOrder ?? 0,
      },
    });

    await recordAudit({
      userId: actorUserId,
      entityType: "EVENT_TYPE",
      entityId: created.id,
      action: "CREATED",
      newValue: { name: created.name },
    });

    return created;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(`A type named "${name}" already exists.`);
    }
    throw error;
  }
}

export async function updateEventType(
  id: string,
  input: {
    name?: string;
    emoji?: string | null;
    active?: boolean;
    sortOrder?: number;
  },
  actorUserId: string,
) {
  const existing = await prisma.eventType.findUnique({
    where: { id },
    select: { id: true, name: true, emoji: true, active: true, sortOrder: true },
  });
  if (!existing) throw notFound("That type no longer exists.");

  const name = input.name?.trim();
  if (input.name !== undefined && !name) {
    throw validationError("Type name is required.");
  }

  try {
    const updated = await prisma.eventType.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(input.emoji !== undefined ? { emoji: input.emoji } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });

    await recordAudit({
      userId: actorUserId,
      entityType: "EVENT_TYPE",
      entityId: id,
      action: "UPDATED",
      oldValue: { ...existing },
      newValue: { name: updated.name, active: updated.active },
    });

    return updated;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(`A type named "${name}" already exists.`);
    }
    throw error;
  }
}

/**
 * Deletes a type, but only when nothing references it.
 *
 * A type in use is deactivated instead: deleting it would either orphan events
 * or silently rewrite their history.
 */
export async function deleteEventType(id: string, actorUserId: string) {
  const existing = await prisma.eventType.findUnique({
    where: { id },
    select: { id: true, name: true, _count: { select: { events: true } } },
  });
  if (!existing) throw notFound("That type no longer exists.");

  if (existing._count.events > 0) {
    throw conflict(
      `"${existing.name}" is used by ${existing._count.events} event(s). Deactivate it instead — it will stop appearing on new events but stays on existing ones.`,
    );
  }

  await prisma.eventType.delete({ where: { id } });

  await recordAudit({
    userId: actorUserId,
    entityType: "EVENT_TYPE",
    entityId: id,
    action: "DELETED",
    oldValue: { name: existing.name },
  });
}

/**
 * Resolves a type name to its id, creating it if it does not exist.
 *
 * Used only by bulk import, where rejecting a whole spreadsheet because one row
 * introduces a new type would be worse than accepting it. Matching is
 * case-insensitive so "NHL" and "nhl" do not become two categories.
 */
export async function resolveOrCreateEventType(
  name: string,
  actorUserId: string,
): Promise<{ id: string; created: boolean }> {
  const trimmed = name.trim();
  if (!trimmed) throw validationError("Type is required.");

  const existing = await prisma.eventType.findFirst({
    where: { name: { equals: trimmed, mode: "insensitive" } },
    select: { id: true },
  });

  if (existing) return { id: existing.id, created: false };

  const created = await createEventType({ name: trimmed }, actorUserId);
  return { id: created.id, created: true };
}
