/**
 * Audit trail.
 *
 * Records who changed what, and when. Writes participate in the caller's
 * transaction when one is supplied, so an audit row can never survive a rolled
 * back change.
 *
 * Auditing must never be the reason an operation fails: if the log write itself
 * errors it is reported to the server logs and swallowed.
 */

import type { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "@/lib/db/prisma";

export type AuditEntityType =
  | "EVENT"
  | "REVIEW_STAGE"
  | "EVENT_NOTE"
  | "EVENT_TYPE"
  | "USER"
  | "SETTINGS"
  | "IMPERSONATION"
  | "MAINTENANCE";

/**
 * A recorded before/after payload.
 *
 * Values are always primitives, dates already reduced to ISO strings, or plain
 * nested structures — `diffChanges` guarantees that. Typed loosely here because
 * callers legitimately diff heterogeneous shapes; the single cast to Prisma's
 * JSON type happens at the write below rather than at every call site.
 */
export type AuditPayload = Record<string, unknown>;

export interface AuditEntry {
  /**
   * The account that really performed the action. `null` for the scheduler.
   *
   * When an administrator is impersonating someone this stays the
   * administrator — "who actually did this" must never be recoverable only by
   * inference.
   */
  userId: string | null;
  /** Set when acting through impersonation: the account being viewed as. */
  impersonatedUserId?: string | null;
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  oldValue?: AuditPayload | null;
  newValue?: AuditPayload | null;
}

export async function recordAudit(
  entry: AuditEntry,
  client: PrismaTransactionClient = prisma,
): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        userId: entry.userId,
        impersonatedUserId: entry.impersonatedUserId ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        // The one cast to Prisma's JSON input type, made here at the
        // persistence boundary where the payload is about to be serialised
        // anyway, instead of contorting every caller's shape to satisfy it.
        oldValue: (entry.oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
        newValue: (entry.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    console.error("[audit] failed to record entry", { entry, error });
  }
}

/**
 * Reduces a before/after pair to only the fields that actually changed, so the
 * log stays readable instead of storing a full row snapshot per edit.
 */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { old: AuditPayload; new: AuditPayload } | null {
  const oldValues: AuditPayload = {};
  const newValues: AuditPayload = {};
  let changed = false;

  for (const key of Object.keys(after)) {
    const previous = before[key];
    const next = after[key];
    const normalise = (value: unknown) =>
      value instanceof Date ? value.toISOString() : value ?? null;

    if (normalise(previous) !== normalise(next)) {
      oldValues[key] = normalise(previous);
      newValues[key] = normalise(next);
      changed = true;
    }
  }

  return changed ? { old: oldValues, new: newValues } : null;
}
