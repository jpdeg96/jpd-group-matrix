/**
 * Event Dashboard services.
 *
 * The dashboard is where events live until somebody ticks Complete, which is
 * the sole path into C1 staging. Promotion is deliberately manual now — nothing
 * moves an event along on a timer.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  dbDateFromPlainDate,
  plainDateFromDbDate,
  toPlainDate,
  type PlainDate,
} from "@/lib/date/plain-date";
import {
  buildReviewSchedule,
  stageScheduleDrift,
  STALE_COMPLETION_DAYS,
} from "@/lib/domain/review-schedule";
import { reviewStageLabel } from "@/lib/domain/constants";
import { conflict, forbidden, notFound, validationError } from "@/lib/errors";
import { assertCanAssign, auditActor, type ActorContext } from "@/lib/auth/actor";
import { canAssignOthers } from "@/lib/domain/constants";
import { businessToday, getScheduleConfig, getSettings } from "./settings";
import { recordAudit } from "./audit";

/**
 * Fields that describe *what the event is*, as opposed to the operational state
 * of working on it. Only managers and administrators may change these.
 *
 * Everything else on the row — assignment, the three checkboxes, notes, flags —
 * stays open to everyone, because that is the actual day-to-day work.
 */
const EVENT_DETAIL_FIELDS = [
  "eventDate",
  "eventTypeId",
  "awayTeam",
  "homeTeam",
  "venue",
] as const;

function assertCanEditDetails(actor: ActorContext, input: object): void {
  const touchesDetails = EVENT_DETAIL_FIELDS.some(
    (field) => (input as Record<string, unknown>)[field] !== undefined,
  );

  if (touchesDetails && !canAssignOthers(actor.effective.role)) {
    throw forbidden(
      "Only managers and administrators can add or edit event details. You can still assign, tick the checkboxes, add notes and raise a flag.",
    );
  }
}

export interface DashboardEventView {
  id: string;
  eventDate: PlainDate;
  eventTypeId: string;
  eventTypeName: string;
  awayTeam: string | null;
  homeTeam: string | null;
  venue: string | null;
  status: "DASHBOARD" | "C1" | "COMPLETED" | "CANCELLED";
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeColor: string | null;
  completedAt: string | null;
  completedByName: string | null;
  seatGeekCheckedAt: string | null;
  seatGeekByName: string | null;
  eventTypeEmoji: string | null;
  ticketDataChecked: boolean;
  ticketDataByName: string | null;
  auditedAt: string | null;
  auditedByName: string | null;
  noteCount: number;
  /**
   * Colors of whoever ticked each box, so a dot beside the timestamp says who
   * did it without another lookup.
   */
  completedByColor: string | null;
  seatGeekByColor: string | null;
  ticketDataByColor: string | null;
  auditedByColor: string | null;
  flaggedAt: string | null;
  flaggedByName: string | null;
  flaggedByColor: string | null;
  flagReason: string | null;
}

const dashboardInclude = {
  eventType: { select: { id: true, name: true, emoji: true } },
  assignee: { select: { id: true, displayName: true, color: true } },
  completedBy: { select: { displayName: true, color: true } },
  seatGeekBy: { select: { displayName: true, color: true } },
  ticketDataBy: { select: { displayName: true, color: true } },
  auditedBy: { select: { displayName: true, color: true } },
  flaggedBy: { select: { displayName: true, color: true } },
  _count: { select: { notes: true } },
} satisfies Prisma.EventInclude;

type EventWithRelations = Prisma.EventGetPayload<{ include: typeof dashboardInclude }>;

function toView(event: EventWithRelations): DashboardEventView {
  return {
    id: event.id,
    eventDate: plainDateFromDbDate(event.eventDate),
    eventTypeId: event.eventType.id,
    eventTypeName: event.eventType.name,
    awayTeam: event.awayTeam,
    homeTeam: event.homeTeam,
    venue: event.venue,
    status: event.status,
    assigneeId: event.assigneeId,
    assigneeName: event.assignee?.displayName ?? null,
    assigneeColor: event.assignee?.color ?? null,
    completedAt: event.completedAt?.toISOString() ?? null,
    completedByName: event.completedBy?.displayName ?? null,
    seatGeekCheckedAt: event.seatGeekCheckedAt?.toISOString() ?? null,
    seatGeekByName: event.seatGeekBy?.displayName ?? null,
    eventTypeEmoji: event.eventType.emoji,
    ticketDataChecked: event.ticketDataChecked,
    ticketDataByName: event.ticketDataBy?.displayName ?? null,
    auditedAt: event.auditedAt?.toISOString() ?? null,
    auditedByName: event.auditedBy?.displayName ?? null,
    noteCount: event._count.notes,
    completedByColor: event.completedBy?.color ?? null,
    seatGeekByColor: event.seatGeekBy?.color ?? null,
    ticketDataByColor: event.ticketDataBy?.color ?? null,
    auditedByColor: event.auditedBy?.color ?? null,
    flaggedAt: event.flaggedAt?.toISOString() ?? null,
    flaggedByName: event.flaggedBy?.displayName ?? null,
    flaggedByColor: event.flaggedBy?.color ?? null,
    flagReason: event.flagReason,
  };
}

export interface DashboardFilters {
  search?: string;
  eventTypeId?: string;
  assigneeId?: string;
  from?: PlainDate;
  to?: PlainDate;
  /**
   * Include events already promoted to C1.
   *
   * Promoted events are no longer removed from the dashboard — they stay as the
   * permanent record of the event. The dashboard screen loads them and hides
   * them behind the "Completed" chip; the API keeps the flag off by default so
   * existing callers see no change.
   */
  includePromoted?: boolean;
  /** Only events currently flagged for manager review. */
  flaggedOnly?: boolean;
  sort?: DashboardSortKey;
  direction?: "asc" | "desc";
}

export type DashboardSortKey =
  | "eventDate"
  | "eventType"
  | "awayTeam"
  | "homeTeam"
  | "venue"
  | "assignee"
  | "createdAt";

/** Dashboard rows, soonest event first. */
export async function listDashboardEvents(
  filters: DashboardFilters = {},
): Promise<DashboardEventView[]> {
  const today = await businessToday();

  const where: Prisma.EventWhereInput = {
    status: filters.includePromoted ? { in: ["DASHBOARD", "C1"] } : "DASHBOARD",
    // Past events leave the board. Filtered on the date as well as the archive
    // flag so the cut-off is correct the moment midnight passes, rather than
    // whenever maintenance next runs — the job makes it durable, the predicate
    // makes it immediate.
    archivedAt: null,
    eventDate: { gte: dbDateFromPlainDate(today) },
  };

  if (filters.eventTypeId) where.eventTypeId = filters.eventTypeId;
  if (filters.flaggedOnly) where.flaggedAt = { not: null };

  if (filters.assigneeId) {
    where.assigneeId = filters.assigneeId === "UNASSIGNED" ? null : filters.assigneeId;
  }

  if (filters.from || filters.to) {
    // Narrowed, never widened: a `from` earlier than today must not drag past
    // events back onto the board. Whichever lower bound is later wins.
    const from =
      filters.from && filters.from > today ? filters.from : today;

    where.eventDate = {
      gte: dbDateFromPlainDate(from),
      ...(filters.to ? { lte: dbDateFromPlainDate(filters.to) } : {}),
    };
  }

  if (filters.search) {
    const contains = filters.search;
    where.OR = [
      { awayTeam: { contains, mode: "insensitive" } },
      { homeTeam: { contains, mode: "insensitive" } },
      { venue: { contains, mode: "insensitive" } },
      { eventType: { name: { contains, mode: "insensitive" } } },
    ];
  }

  const direction = filters.direction ?? "asc";

  // Relation sorts (type, assignee) go through the related column so Postgres
  // does the ordering rather than the application.
  const orderBy: Prisma.EventOrderByWithRelationInput[] =
    filters.sort === "eventType"
      ? [{ eventType: { name: direction } }, { eventDate: "asc" }]
      : filters.sort === "assignee"
        ? [{ assignee: { displayName: direction } }, { eventDate: "asc" }]
        : filters.sort === "awayTeam"
          ? [{ awayTeam: direction }, { eventDate: "asc" }]
          : filters.sort === "homeTeam"
            ? [{ homeTeam: direction }, { eventDate: "asc" }]
            : filters.sort === "venue"
              ? [{ venue: direction }, { eventDate: "asc" }]
              : filters.sort === "createdAt"
                ? [{ createdAt: direction }]
                : [{ eventDate: direction }, { createdAt: "asc" }];

  const events = await prisma.event.findMany({
    where,
    include: dashboardInclude,
    orderBy,
  });

  return events.map(toView);
}

export async function getEvent(eventId: string): Promise<DashboardEventView> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: dashboardInclude,
  });
  if (!event) throw notFound("That event no longer exists.");
  return toView(event);
}

export interface CreateEventInput {
  eventDate: PlainDate;
  eventTypeId: string;
  awayTeam?: string | null;
  homeTeam?: string | null;
  venue?: string | null;
  assigneeId?: string | null;
}

export async function createEvent(input: CreateEventInput, actor: ActorContext) {
  // Creating an event is a detail change by definition.
  if (!canAssignOthers(actor.effective.role)) {
    throw forbidden("Only managers and administrators can add events.");
  }

  await assertEventTypeUsable(input.eventTypeId);

  if (input.assigneeId) {
    assertCanAssign(actor, null, input.assigneeId);
    await assertAssignable(input.assigneeId, null);
  }

  const event = await prisma.event.create({
    data: {
      eventDate: dbDateFromPlainDate(toPlainDate(input.eventDate)),
      eventTypeId: input.eventTypeId,
      awayTeam: input.awayTeam ?? null,
      homeTeam: input.homeTeam ?? null,
      venue: input.venue ?? null,
      assigneeId: input.assigneeId ?? null,
      status: "DASHBOARD",
    },
    include: dashboardInclude,
  });

  await recordAudit({
    ...auditActor(actor),
    entityType: "EVENT",
    entityId: event.id,
    action: "CREATED",
    newValue: {
      eventDate: plainDateFromDbDate(event.eventDate),
      type: event.eventType.name,
      awayTeam: event.awayTeam,
      homeTeam: event.homeTeam,
    },
  });

  return toView(event);
}

export interface UpdateEventInput {
  eventDate?: PlainDate;
  eventTypeId?: string;
  awayTeam?: string | null;
  homeTeam?: string | null;
  venue?: string | null;
  assigneeId?: string | null;
  complete?: boolean;
  seatGeekChecked?: boolean;
  ticketDataChecked?: boolean;
  audited?: boolean;
}

/**
 * Applies a partial update.
 *
 * Only the fields actually present are written, as targeted column updates, so
 * two people editing different cells of the same row cannot overwrite each
 * other. Nothing ever posts a whole row back.
 */
export async function updateEvent(
  eventId: string,
  input: UpdateEventInput,
  actor: ActorContext,
): Promise<{ event: DashboardEventView; promoted: boolean; demoted: boolean }> {
  const existing = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      eventDate: true,
      eventTypeId: true,
      status: true,
      assigneeId: true,
      completedAt: true,
      seatGeekCheckedAt: true,
      ticketDataChecked: true,
      auditedAt: true,
    },
  });
  if (!existing) throw notFound("That event no longer exists.");
  if (existing.status === "CANCELLED") {
    throw conflict("This event has been cancelled.");
  }

  assertCanEditDetails(actor, input);

  const data: Prisma.EventUncheckedUpdateInput = {};

  if (input.eventTypeId !== undefined) {
    await assertEventTypeUsable(input.eventTypeId);
    data.eventTypeId = input.eventTypeId;
  }
  if (input.eventDate !== undefined) {
    data.eventDate = dbDateFromPlainDate(toPlainDate(input.eventDate));
  }
  if (input.awayTeam !== undefined) data.awayTeam = input.awayTeam;
  if (input.homeTeam !== undefined) data.homeTeam = input.homeTeam;
  if (input.venue !== undefined) data.venue = input.venue;

  if (input.assigneeId !== undefined) {
    assertCanAssign(actor, existing.assigneeId, input.assigneeId);
    await assertAssignable(input.assigneeId, existing.assigneeId);
    data.assigneeId = input.assigneeId;
  }

  if (input.seatGeekChecked !== undefined) {
    const isChecked = existing.seatGeekCheckedAt !== null;
    if (input.seatGeekChecked && !isChecked) {
      data.seatGeekCheckedAt = new Date();
      data.seatGeekById = actor.effective.id;
    } else if (!input.seatGeekChecked && isChecked) {
      data.seatGeekCheckedAt = null;
      data.seatGeekById = null;
    }
  }

  if (input.ticketDataChecked !== undefined) {
    // No timestamp on this one, by request — just the flag and who set it.
    data.ticketDataChecked = input.ticketDataChecked;
    data.ticketDataById = input.ticketDataChecked ? actor.effective.id : null;
  }

  if (input.audited !== undefined) {
    const isAudited = existing.auditedAt !== null;
    if (input.audited && !isAudited) {
      data.auditedAt = new Date();
      data.auditedById = actor.effective.id;
    } else if (!input.audited && isAudited) {
      data.auditedAt = null;
      data.auditedById = null;
    }
  }

  let promoted = false;
  let demoted = false;

  if (input.complete !== undefined) {
    const isComplete = existing.completedAt !== null;

    if (input.complete && !isComplete) {
      data.completedAt = new Date();
      data.completedById = actor.effective.id;
      data.status = "C1";
      data.promotedAt = new Date();
      promoted = true;
    } else if (!input.complete && isComplete) {
      await assertSafeToDemote(eventId);
      data.completedAt = null;
      data.completedById = null;
      data.status = "DASHBOARD";
      data.promotedAt = null;
      demoted = true;
    }
  }

  // The status flip and the stage rows must land together: an event must never
  // be sitting in C1 with no stages, or back on the dashboard with orphans.
  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.event.update({ where: { id: eventId }, data });
    }

    if (promoted) {
      const eventDate = plainDateFromDbDate(
        input.eventDate !== undefined
          ? dbDateFromPlainDate(toPlainDate(input.eventDate))
          : existing.eventDate,
      );
      await createStagesForEvent(tx, eventId, eventDate);
    }

    if (demoted) {
      // Safe because assertSafeToDemote proved no stage work exists.
      await tx.reviewStage.deleteMany({ where: { eventId } });
    }
  });

  // Moving an event date leaves its C1 stages pointing at the old schedule.
  // Nothing is rewritten — a deadline only moves when an administrator says so
  // — but the event is flagged so the mismatch cannot go unnoticed.
  const dateMoved =
    input.eventDate !== undefined &&
    plainDateFromDbDate(existing.eventDate) !== input.eventDate;

  if (dateMoved) {
    await warnAboutScheduleDrift(eventId, input.eventDate!, existing.eventDate, actor);
  }

  const event = await getEvent(eventId);

  // Completion toggles get their own audit actions rather than being buried in
  // a generic UPDATE. They are the thing people ask about after the fact —
  // "who unchecked this, and when?" — so they need to be directly queryable.
  if (promoted || demoted) {
    await recordAudit({
      ...auditActor(actor),
      entityType: "EVENT",
      entityId: eventId,
      action: promoted ? "COMPLETE_CHECKED" : "COMPLETE_UNCHECKED",
      oldValue: { completedAt: existing.completedAt?.toISOString() ?? null },
      newValue: { completedAt: event.completedAt },
    });
  }

  // Anything else that changed is recorded separately, so a single request that
  // ticks Complete *and* edits a field produces both entries.
  const otherChanges = Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== "complete"),
  );

  if (Object.keys(otherChanges).length > 0) {
    await recordAudit({
      ...auditActor(actor),
      entityType: "EVENT",
      entityId: eventId,
      action: "UPDATED",
      newValue: otherChanges,
    });
  }

  return { event, promoted, demoted };
}

/**
 * Creates the stage rows for an event entering C1.
 *
 * Stages whose deadline had already passed are recorded as SKIPPED rather than
 * PENDING — they were never actionable, and counting them as outstanding would
 * make C1 permanently red and productivity reporting misleading.
 *
 * `skipDuplicates` against the (event, offset) unique index makes this safe to
 * re-run.
 */
async function createStagesForEvent(
  tx: Prisma.TransactionClient,
  eventId: string,
  eventDate: PlainDate,
): Promise<number> {
  const [config, today] = await Promise.all([getScheduleConfig(), businessToday()]);
  const schedule = buildReviewSchedule(eventDate, today, config);

  const result = await tx.reviewStage.createMany({
    data: schedule.map((plan) => ({
      eventId,
      offsetDays: plan.offsetDays,
      reviewDue: dbDateFromPlainDate(plan.reviewDue),
      status: plan.alreadyPast ? ("SKIPPED" as const) : ("PENDING" as const),
    })),
    skipDuplicates: true,
  });

  // Every stage already in the past means there is nothing left to work on.
  if (schedule.every((plan) => plan.alreadyPast)) {
    await tx.event.update({ where: { id: eventId }, data: { status: "COMPLETED" } });
  }

  return result.count;
}

/**
 * Refuses to pull an event back out of C1 once real work has happened there.
 *
 * Unticking Complete is an undo for a misclick, not a way to silently discard
 * completed reviews.
 */
async function assertSafeToDemote(eventId: string): Promise<void> {
  const doneStages = await prisma.reviewStage.count({
    where: { eventId, status: "DONE" },
  });

  if (doneStages > 0) {
    throw conflict(
      `This event already has ${doneStages} completed review stage(s) in C1. Unticking Complete would discard that work — cancel the event instead if it should not proceed.`,
    );
  }
}

/**
 * Deletes an event outright, taking its C1 row, stages and notes with it via
 * the cascade — exactly as specified: removing it from the dashboard removes it
 * from C1.
 *
 * Events with completed stage history are cancelled instead, so productivity
 * reporting keeps its record.
 */
export async function deleteEvent(
  eventId: string,
  actor: ActorContext,
): Promise<{ outcome: "DELETED" | "CANCELLED" }> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      status: true,
      eventDate: true,
      awayTeam: true,
      homeTeam: true,
      _count: { select: { stages: true } },
    },
  });
  if (!event) throw notFound("That event no longer exists.");

  const doneStages = await prisma.reviewStage.count({
    where: { eventId, status: "DONE" },
  });

  if (doneStages > 0) {
    await prisma.event.update({
      where: { id: eventId },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    await recordAudit({
      ...auditActor(actor),
      entityType: "EVENT",
      entityId: eventId,
      action: "CANCELLED",
      oldValue: { status: event.status, completedStages: doneStages },
    });

    return { outcome: "CANCELLED" };
  }

  await prisma.event.delete({ where: { id: eventId } });

  await recordAudit({
    ...auditActor(actor),
    entityType: "EVENT",
    entityId: eventId,
    action: "DELETED",
    oldValue: {
      eventDate: plainDateFromDbDate(event.eventDate),
      awayTeam: event.awayTeam,
      homeTeam: event.homeTeam,
    },
  });

  return { outcome: "DELETED" };
}

/**
 * Raises a flag when an event date moves out from under its C1 stages.
 *
 * Deliberately a warning rather than a recalculation. Silently rewriting review
 * dates would move deadlines people are working to, without anybody deciding
 * that should happen; silently leaving them wrong is worse. Flagging puts it in
 * front of a manager and leaves the fix to an administrator, who is the only
 * role that can move a date anyway.
 *
 * Hand-set dates are excluded — marking a date manual is exactly the act of
 * opting out of the formula.
 */
async function warnAboutScheduleDrift(
  eventId: string,
  newDate: PlainDate,
  previousDate: Date,
  actor: ActorContext,
): Promise<void> {
  const stages = await prisma.reviewStage.findMany({
    where: { eventId, status: "PENDING" },
    select: {
      offsetDays: true,
      reviewDue: true,
      reviewDueOverridden: true,
      status: true,
    },
  });

  if (stages.length === 0) return;

  const config = await getScheduleConfig();

  const drifted = stages
    .map((stage) => ({
      offsetDays: stage.offsetDays,
      ...stageScheduleDrift(
        {
          offsetDays: stage.offsetDays,
          reviewDue: plainDateFromDbDate(stage.reviewDue),
          reviewDueOverridden: stage.reviewDueOverridden,
          status: stage.status,
        },
        newDate,
        config,
      ),
    }))
    .filter((entry) => entry.drifted);

  if (drifted.length === 0) return;

  const summary = drifted
    .map((entry) => `${reviewStageLabel(entry.offsetDays)} → ${entry.expected}`)
    .join(", ");

  const reason =
    `Event date moved from ${plainDateFromDbDate(previousDate)} to ${newDate}. ` +
    `${drifted.length} review date(s) no longer match the schedule: ${summary}. ` +
    `An administrator should confirm or update them.`;

  await prisma.event.update({
    where: { id: eventId },
    data: {
      // Preserve the original raise time if it was already flagged — this is
      // additional context on an open concern, not a new incident.
      flaggedAt: new Date(),
      flaggedById: actor.effective.id,
      flagReason: reason,
      flagResolvedAt: null,
      flagResolvedById: null,
    },
  });

  await recordAudit({
    ...auditActor(actor),
    entityType: "EVENT",
    entityId: eventId,
    action: "SCHEDULE_DRIFT_FLAGGED",
    oldValue: { eventDate: plainDateFromDbDate(previousDate) },
    newValue: { eventDate: newDate, driftedStages: drifted },
  });
}

/* -------------------------------------------------------------------------- */
/* Completion history                                                         */
/* -------------------------------------------------------------------------- */

export interface CompletionHistoryEntry {
  id: string;
  at: string;
  checked: boolean;
  actorName: string;
  actorColor: string;
  /** Set when the change was made while viewing as somebody else. */
  impersonatedName: string | null;
}

/**
 * Every time Complete was ticked or unticked on an event.
 *
 * Read from the audit log rather than a separate table: the log already records
 * every change with attribution, and a second source of truth for the same fact
 * is a bug waiting to happen. The dedicated COMPLETE_CHECKED /
 * COMPLETE_UNCHECKED actions make it a cheap indexed lookup.
 */
export async function getCompletionHistory(
  eventId: string,
): Promise<CompletionHistoryEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: {
      entityType: "EVENT",
      entityId: eventId,
      action: { in: ["COMPLETE_CHECKED", "COMPLETE_UNCHECKED"] },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      createdAt: true,
      action: true,
      impersonatedUserId: true,
      user: { select: { displayName: true, color: true } },
    },
  });

  const impersonatedIds = rows
    .map((row) => row.impersonatedUserId)
    .filter((id): id is string => id !== null);

  const impersonated =
    impersonatedIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: impersonatedIds } },
          select: { id: true, displayName: true },
        })
      : [];

  const names = new Map(impersonated.map((user) => [user.id, user.displayName]));

  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt.toISOString(),
    checked: row.action === "COMPLETE_CHECKED",
    actorName: row.user?.displayName ?? "System",
    actorColor: row.user?.color ?? "#64748b",
    impersonatedName: row.impersonatedUserId
      ? (names.get(row.impersonatedUserId) ?? "Unknown user")
      : null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Flags                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Raises a flag asking a manager or administrator to look at this event.
 *
 * Anyone can raise one — that is the point: the person who spots the problem is
 * usually not the person allowed to fix it. Only managers and administrators
 * can clear it, so a flag cannot be quietly dismissed by whoever caused it.
 *
 * Re-flagging an already-flagged event updates the reason rather than stacking
 * duplicates.
 */
export async function flagEvent(
  eventId: string,
  reason: string | null,
  actor: ActorContext,
): Promise<DashboardEventView> {
  const existing = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, flaggedAt: true },
  });
  if (!existing) throw notFound("That event no longer exists.");

  await prisma.event.update({
    where: { id: eventId },
    data: {
      flaggedAt: existing.flaggedAt ?? new Date(),
      flaggedById: actor.effective.id,
      flagReason: reason?.trim() || null,
      // Raising a flag reopens it, so a previously resolved event does not look
      // both flagged and resolved at once.
      flagResolvedAt: null,
      flagResolvedById: null,
    },
  });

  await recordAudit({
    ...auditActor(actor),
    entityType: "EVENT",
    entityId: eventId,
    action: existing.flaggedAt ? "FLAG_UPDATED" : "FLAGGED",
    newValue: { reason },
  });

  return getEvent(eventId);
}

/** Clears a flag. Manager or administrator only. */
export async function resolveFlag(
  eventId: string,
  actor: ActorContext,
): Promise<DashboardEventView> {
  if (!canAssignOthers(actor.effective.role)) {
    throw forbidden(
      "Only managers and administrators can clear a flag. Raise a note if you need to add context.",
    );
  }

  const existing = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, flaggedAt: true, flagReason: true },
  });
  if (!existing) throw notFound("That event no longer exists.");
  if (!existing.flaggedAt) throw conflict("This event is not flagged.");

  await prisma.event.update({
    where: { id: eventId },
    data: {
      flaggedAt: null,
      flagReason: null,
      flagResolvedAt: new Date(),
      flagResolvedById: actor.effective.id,
    },
  });

  await recordAudit({
    ...auditActor(actor),
    entityType: "EVENT",
    entityId: eventId,
    action: "FLAG_RESOLVED",
    oldValue: { reason: existing.flagReason },
  });

  return getEvent(eventId);
}

/* -------------------------------------------------------------------------- */
/* Guards                                                                     */
/* -------------------------------------------------------------------------- */

async function assertEventTypeUsable(eventTypeId: string): Promise<void> {
  const type = await prisma.eventType.findUnique({
    where: { id: eventTypeId },
    select: { active: true, name: true },
  });

  if (!type) throw validationError("That event type no longer exists.");
  if (!type.active) {
    throw validationError(
      `"${type.name}" is inactive and cannot be used for new events.`,
    );
  }
}

/**
 * Inactive employees stay attached to the work they already hold — that is
 * historical fact — but cannot be newly assigned.
 */
async function assertAssignable(
  nextAssigneeId: string | null | undefined,
  currentAssigneeId: string | null,
): Promise<void> {
  if (!nextAssigneeId) return;
  if (nextAssigneeId === currentAssigneeId) return;

  const user = await prisma.user.findUnique({
    where: { id: nextAssigneeId },
    select: { active: true, displayName: true },
  });

  if (!user) throw validationError("That employee no longer exists.");
  if (!user.active) {
    throw validationError(`Unable to assign inactive employee ${user.displayName}.`);
  }
}

/* -------------------------------------------------------------------------- */
/* Statistics                                                                 */
/* -------------------------------------------------------------------------- */

export async function getDashboardStats(userId: string) {
  const today = await businessToday();

  // "Open" work is what has not yet been sent to C1, on an event that has not
  // happened yet. Promoted and past events remain in the database but must not
  // inflate the outstanding-work counters, or the numbers stop meaning "things
  // still to do".
  const open = {
    status: "DASHBOARD",
    archivedAt: null,
    eventDate: { gte: dbDateFromPlainDate(today) },
  } as const;

  const live = { archivedAt: null, eventDate: { gte: dbDateFromPlainDate(today) } };

  const [total, unassigned, seatGeekPending, ticketDataPending, mine, settings] =
    await Promise.all([
      prisma.event.count({ where: open }),
      prisma.event.count({ where: { ...open, assigneeId: null } }),
      prisma.event.count({ where: { ...open, seatGeekCheckedAt: null } }),
      prisma.event.count({ where: { ...open, ticketDataChecked: false } }),
      prisma.event.count({ where: { ...open, assigneeId: userId } }),
      getSettings(),
    ]);

  const staleCutoff = new Date(
    Date.now() - STALE_COMPLETION_DAYS * 86_400_000,
  );

  const [archived, flagged, auditPending, completed, staleCompleted] =
    await Promise.all([
      // Events that have left the board because their date passed. Surfaced as
      // a count so "where did that row go?" has an answer, rather than events
      // appearing to vanish.
      prisma.event.count({ where: { archivedAt: { not: null } } }),
      prisma.event.count({
        where: {
          ...live,
          status: { in: ["DASHBOARD", "C1"] },
          flaggedAt: { not: null },
        },
      }),
      prisma.event.count({ where: { ...open, auditedAt: null } }),
      prisma.event.count({ where: { ...live, status: "C1" } }),
      prisma.event.count({
        where: { ...live, status: "C1", completedAt: { lt: staleCutoff } },
      }),
    ]);

  return {
    total,
    unassigned,
    seatGeekPending,
    ticketDataPending,
    auditPending,
    mine,
    archived,
    flagged,
    completed,
    staleCompleted,
    staleDays: STALE_COMPLETION_DAYS,
    timeZone: settings.timeZone,
  };
}
