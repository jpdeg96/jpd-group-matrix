/**
 * Bulk changes to events, from the Dashboard.
 *
 * The whole design here is that nothing is applied from a form. A bulk edit is
 * the one action on this site where a mistake is not a mistake on one row — a
 * mis-picked venue lands on forty events at once, and the person who did it has
 * no list of what they hit. So the work is split in two: `planBulkUpdate`
 * computes exactly what would happen and writes nothing, and `applyBulkUpdate`
 * carries out that same plan. The review screen is not a courtesy confirmation
 * dialog; it is the output of the first half.
 *
 * The plan is recomputed at apply time rather than trusted from the browser.
 * Otherwise the review screen becomes the security boundary, and it cannot be
 * one: a client that can post a plan can post a plan for rows it never showed.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { conflict, forbidden, validationError } from "@/lib/errors";
import { auditActor, type ActorContext } from "@/lib/auth/actor";
import { canAssignOthers } from "@/lib/domain/constants";
import {
  plainDateFromDbDate,
  formatPlainDateWithWeekday,
  type PlainDate,
} from "@/lib/date/plain-date";
import { recordAudit } from "./audit";

/** Above this, a single bulk action stops being reviewable and starts being a script. */
export const MAX_BULK_EVENTS = 200;

/** Matches the single-note limit; a bulk note is still just a note. */
const MAX_NOTE_LENGTH = 2_000;

export type BulkFlagAction =
  | { action: "RAISE"; reason: string | null }
  | { action: "CLEAR" };

export interface BulkEventInput {
  eventIds: string[];
  eventTypeId?: string;
  awayTeam?: string | null;
  homeTeam?: string | null;
  venue?: string | null;
  assigneeId?: string | null;
  flag?: BulkFlagAction;
  note?: string;
  /** Exclusive: a delete cannot be combined with an edit. */
  remove?: boolean;
}

/** One field moving, in display terms rather than database terms. */
export interface BulkChange {
  field: string;
  from: string | null;
  to: string | null;
  /**
   * `ADD` is something gained rather than replaced — a note appended to a
   * thread. Without the distinction the review screen renders an added note as
   * "empty → text", which reads as though a blank note is being overwritten and
   * suggests the existing notes are at risk. They are not.
   */
  kind?: "SET" | "ADD";
}

export type BulkOutcome = "UPDATE" | "DELETE" | "CANCEL" | "SKIP" | "UNCHANGED";

export interface BulkEventPlan {
  eventId: string;
  label: string;
  outcome: BulkOutcome;
  /** Why this row is not doing the obvious thing. Always set for SKIP and CANCEL. */
  reason: string | null;
  changes: BulkChange[];
}

export interface BulkPlan {
  events: BulkEventPlan[];
  counts: Record<Lowercase<BulkOutcome>, number>;
  /** Things the person should know before pressing the button, not per row. */
  warnings: string[];
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every field here is either an event detail or a manager action, so one role
 * check covers the lot. Checked in the service as well as the route: a bulk
 * edit is the higher-consequence version of the single-row edit, and it must
 * not be reachable by a path that forgot.
 */
function assertMayBulkEdit(actor: ActorContext): void {
  if (!canAssignOthers(actor.effective.role)) {
    throw forbidden("Only managers and administrators can make bulk changes.");
  }
}

function assertCoherent(input: BulkEventInput): void {
  if (input.eventIds.length === 0) {
    throw validationError("Select at least one event first.");
  }
  if (input.eventIds.length > MAX_BULK_EVENTS) {
    throw validationError(
      `Select ${MAX_BULK_EVENTS} events or fewer. Beyond that nobody can meaningfully review the change before applying it.`,
    );
  }

  const edits = [
    input.eventTypeId,
    input.awayTeam,
    input.homeTeam,
    input.venue,
    input.assigneeId,
    input.flag,
    input.note,
  ].some((value) => value !== undefined);

  if (input.remove) {
    // Deleting and editing in one action has no useful reading: the edit is
    // either pointless or the delete is a mistake, and guessing which would be
    // the worst possible way to resolve it.
    if (edits) {
      throw validationError(
        "Deleting cannot be combined with other changes. Apply the changes first, or delete on its own.",
      );
    }
    return;
  }

  if (!edits) throw validationError("Choose at least one change to make.");

  if (input.note !== undefined) {
    const trimmed = input.note.trim();
    if (!trimmed) throw validationError("A note cannot be empty.");
    if (trimmed.length > MAX_NOTE_LENGTH) {
      throw validationError(`A note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

const SELECTION = {
  id: true,
  eventDate: true,
  eventTypeId: true,
  awayTeam: true,
  homeTeam: true,
  venue: true,
  status: true,
  assigneeId: true,
  flaggedAt: true,
  flagReason: true,
  eventType: { select: { name: true } },
  assignee: { select: { displayName: true } },
} as const;

type PlannedEvent = Prisma.EventGetPayload<{ select: typeof SELECTION }>;

/** How an event reads in a review list: enough to recognise, short enough to scan. */
function labelFor(event: PlannedEvent): string {
  const teams = [event.awayTeam, event.homeTeam].filter(Boolean).join(" @ ");
  const what = teams || event.venue || event.eventType.name;
  return `${formatPlainDateWithWeekday(plainDateFromDbDate(event.eventDate))} · ${what}`;
}

/** A blank text field means "clear it", which has to read differently from "unchanged". */
function textOrCleared(value: string | null): string | null {
  return value === null ? null : value;
}

/**
 * Works out what would happen, and writes nothing.
 *
 * Rows that cannot take the change are reported rather than dropped. Silently
 * skipping is what makes a bulk edit untrustworthy: "42 updated" against 45
 * selected leaves you with no idea which three, and no reason to believe the
 * next one will behave either.
 */
export async function planBulkUpdate(
  input: BulkEventInput,
  actor: ActorContext,
): Promise<BulkPlan> {
  assertMayBulkEdit(actor);
  assertCoherent(input);

  const events = await prisma.event.findMany({
    where: { id: { in: input.eventIds } },
    select: SELECTION,
    orderBy: [{ eventDate: "asc" }, { id: "asc" }],
  });

  const warnings: string[] = [];

  const missing = input.eventIds.length - events.length;
  if (missing > 0) {
    warnings.push(
      `${missing} of the selected ${missing === 1 ? "event has" : "events have"} been deleted by somebody else since you selected ${missing === 1 ? "it" : "them"}.`,
    );
  }

  // Resolve the *names* of what is being set once, rather than per row: the
  // review screen shows people and event types by name, and a change described
  // as a UUID cannot be reviewed at all.
  const [nextType, nextAssignee] = await Promise.all([
    input.eventTypeId === undefined
      ? null
      : prisma.eventType.findUnique({
          where: { id: input.eventTypeId },
          select: { name: true, active: true },
        }),
    input.assigneeId === undefined || input.assigneeId === null
      ? null
      : prisma.user.findUnique({
          where: { id: input.assigneeId },
          select: { displayName: true, active: true },
        }),
  ]);

  if (input.eventTypeId !== undefined) {
    if (!nextType) throw validationError("That event type no longer exists.");
    if (!nextType.active) {
      throw validationError(`"${nextType.name}" is inactive and cannot be used.`);
    }
  }
  if (input.assigneeId !== undefined && input.assigneeId !== null) {
    if (!nextAssignee) throw validationError("That employee no longer exists.");
    if (!nextAssignee.active) {
      throw validationError(
        `Unable to assign inactive employee ${nextAssignee.displayName}.`,
      );
    }
  }

  // Which of these have review work already done. An event with a finished
  // checkpoint is cancelled rather than deleted, so productivity reporting
  // keeps its record — and the review screen has to say so, because "delete"
  // and "cancel" are visibly different outcomes.
  const withDoneStages = input.remove
    ? new Set(
        (
          await prisma.reviewStage.groupBy({
            by: ["eventId"],
            where: { eventId: { in: events.map((event) => event.id) }, status: "DONE" },
          })
        ).map((row) => row.eventId),
      )
    : new Set<string>();

  const plans = events.map<BulkEventPlan>((event) => {
    const label = labelFor(event);

    if (input.remove) {
      return withDoneStages.has(event.id)
        ? {
            eventId: event.id,
            label,
            outcome: "CANCEL",
            reason:
              "Has completed review work, so it will be cancelled rather than deleted — the record is kept.",
            changes: [],
          }
        : { eventId: event.id, label, outcome: "DELETE", reason: null, changes: [] };
    }

    if (event.status === "CANCELLED") {
      return {
        eventId: event.id,
        label,
        outcome: "SKIP",
        reason: "Cancelled events cannot be edited.",
        changes: [],
      };
    }

    const changes: BulkChange[] = [];

    if (input.eventTypeId !== undefined && input.eventTypeId !== event.eventTypeId) {
      changes.push({ field: "Type", from: event.eventType.name, to: nextType!.name });
    }
    if (input.awayTeam !== undefined && input.awayTeam !== event.awayTeam) {
      changes.push({
        field: "Away team / artist",
        from: textOrCleared(event.awayTeam),
        to: textOrCleared(input.awayTeam),
      });
    }
    if (input.homeTeam !== undefined && input.homeTeam !== event.homeTeam) {
      changes.push({
        field: "Home team",
        from: textOrCleared(event.homeTeam),
        to: textOrCleared(input.homeTeam),
      });
    }
    if (input.venue !== undefined && input.venue !== event.venue) {
      changes.push({
        field: "Venue",
        from: textOrCleared(event.venue),
        to: textOrCleared(input.venue),
      });
    }
    if (input.assigneeId !== undefined && input.assigneeId !== event.assigneeId) {
      changes.push({
        field: "Assigned",
        from: event.assignee?.displayName ?? null,
        to: nextAssignee?.displayName ?? null,
      });
    }

    if (input.flag !== undefined) {
      if (input.flag.action === "RAISE") {
        changes.push({
          field: event.flaggedAt ? "Flag reason" : "Flag",
          from: event.flaggedAt ? (event.flagReason ?? "flagged, no reason") : null,
          to: input.flag.reason ?? "flagged, no reason",
        });
      } else if (event.flaggedAt) {
        changes.push({
          field: "Flag",
          from: event.flagReason ?? "flagged, no reason",
          to: null,
        });
      }
    }

    if (input.note !== undefined) {
      changes.push({
        field: "Note",
        from: null,
        to: input.note.trim(),
        kind: "ADD",
      });
    }

    return changes.length === 0
      ? {
          eventId: event.id,
          label,
          outcome: "UNCHANGED",
          reason: "Already matches what you chose.",
          changes: [],
        }
      : { eventId: event.id, label, outcome: "UPDATE", reason: null, changes };
  });

  const counts = {
    update: plans.filter((plan) => plan.outcome === "UPDATE").length,
    delete: plans.filter((plan) => plan.outcome === "DELETE").length,
    cancel: plans.filter((plan) => plan.outcome === "CANCEL").length,
    skip: plans.filter((plan) => plan.outcome === "SKIP").length,
    unchanged: plans.filter((plan) => plan.outcome === "UNCHANGED").length,
  };

  if (counts.cancel > 0) {
    warnings.push(
      `${counts.cancel} ${counts.cancel === 1 ? "event has" : "events have"} completed review work and will be cancelled rather than deleted.`,
    );
  }

  return { events: plans, counts, warnings };
}

/* -------------------------------------------------------------------------- */
/* Applying                                                                   */
/* -------------------------------------------------------------------------- */

export interface BulkResult {
  updated: number;
  deleted: number;
  cancelled: number;
  skipped: number;
  unchanged: number;
}

/**
 * Carries out the plan.
 *
 * The plan is recomputed here rather than accepted from the caller, so what is
 * applied is what the database supports right now — and so a client cannot post
 * a plan covering rows the review screen never displayed.
 *
 * One transaction. A half-applied bulk edit is worse than none: the count in
 * the toast is the only record of what happened, and if it is wrong nobody can
 * reconstruct which rows moved.
 */
export async function applyBulkUpdate(
  input: BulkEventInput,
  actor: ActorContext,
): Promise<BulkResult> {
  const plan = await planBulkUpdate(input, actor);

  const acting = plan.events.filter(
    (event) =>
      event.outcome === "UPDATE" ||
      event.outcome === "DELETE" ||
      event.outcome === "CANCEL",
  );
  if (acting.length === 0) {
    throw conflict(
      "Nothing to apply — every selected event was skipped or already matches.",
    );
  }

  const now = new Date();
  const ids = acting.map((event) => event.eventId);

  await prisma.$transaction(async (tx) => {
    if (input.remove) {
      const cancelIds = acting
        .filter((event) => event.outcome === "CANCEL")
        .map((event) => event.eventId);
      const deleteIds = acting
        .filter((event) => event.outcome === "DELETE")
        .map((event) => event.eventId);

      if (cancelIds.length > 0) {
        await tx.event.updateMany({
          where: { id: { in: cancelIds } },
          data: { status: "CANCELLED", cancelledAt: now },
        });
      }
      if (deleteIds.length > 0) {
        // Stages, notes and presence go with it via the cascade.
        await tx.event.deleteMany({ where: { id: { in: deleteIds } } });
      }
      return;
    }

    // Unchecked: this writes foreign keys (type, assignee, flag actors) by id
    // rather than through relation connects, which is what a bulk update needs.
    const data: Prisma.EventUncheckedUpdateManyInput = {};

    if (input.eventTypeId !== undefined) data.eventTypeId = input.eventTypeId;
    if (input.awayTeam !== undefined) data.awayTeam = input.awayTeam;
    if (input.homeTeam !== undefined) data.homeTeam = input.homeTeam;
    if (input.venue !== undefined) data.venue = input.venue;
    if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId;

    if (input.flag?.action === "RAISE") {
      data.flaggedById = actor.effective.id;
      data.flagReason = input.flag.reason?.trim() || null;
      data.flagResolvedAt = null;
      data.flagResolvedById = null;
    } else if (input.flag?.action === "CLEAR") {
      data.flaggedAt = null;
      data.flagReason = null;
      data.flagResolvedAt = now;
      data.flagResolvedById = actor.effective.id;
    }

    if (Object.keys(data).length > 0) {
      await tx.event.updateMany({ where: { id: { in: ids } }, data });
    }

    /*
     * Raising a flag has to preserve an existing `flaggedAt`, the same way the
     * single-row version does — re-flagging updates the reason rather than
     * resetting the clock on how long it has been waiting. updateMany cannot
     * express "only if null", so the already-flagged rows are excluded and the
     * rest stamped separately.
     */
    if (input.flag?.action === "RAISE") {
      await tx.event.updateMany({
        where: { id: { in: ids }, flaggedAt: null },
        data: { flaggedAt: now },
      });
    }

    if (input.note !== undefined) {
      await tx.eventNote.createMany({
        data: ids.map((eventId) => ({
          eventId,
          authorId: actor.effective.id,
          body: input.note!.trim(),
        })),
      });
    }
  });

  /*
   * One audit entry for the action, not one per row.
   *
   * The row-level entries would be identical but for the id, and would bury
   * every other event on the log under a single click. What matters afterwards
   * is "who did this, to what, and what did it say", which is exactly this.
   */
  await recordAudit({
    ...auditActor(actor),
    entityType: "EVENT",
    entityId: "00000000-0000-0000-0000-000000000000",
    action: input.remove ? "BULK_DELETE" : "BULK_UPDATE",
    newValue: {
      eventIds: ids,
      eventTypeId: input.eventTypeId ?? null,
      awayTeam: input.awayTeam ?? null,
      homeTeam: input.homeTeam ?? null,
      venue: input.venue ?? null,
      assigneeId: input.assigneeId ?? null,
      flag: input.flag ?? null,
      note: input.note ?? null,
    },
  });

  return {
    updated: plan.counts.update,
    deleted: plan.counts.delete,
    cancelled: plan.counts.cancel,
    skipped: plan.counts.skip,
    unchanged: plan.counts.unchanged,
  };
}
