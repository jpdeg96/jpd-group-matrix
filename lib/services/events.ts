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
  addDays,
  dbDateFromPlainDate,
  plainDateFromDbDate,
  todayInTimeZone,
  toPlainDate,
  type PlainDate,
} from "@/lib/date/plain-date";
import { startOfBusinessDay } from "./clockify";
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
  /**
   * The business calendar date the completion happened on.
   *
   * Carried separately from the instant because "was that yesterday?" is a
   * calendar question, and answering it in the browser answers it in the
   * browser's timezone against an elapsed-hours count — which is how a
   * completion at 23:00 came to be labelled "today" the next morning.
   * Resolved here, where the business zone is known.
   */
  completedOn: PlainDate | null;
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
  /**
   * Where the row came from when it was not created here. Null for native
   * events. Drives the "Legacy" badge, which explains why an imported row has
   * no assignee and nobody against its completion.
   */
  legacySource: string | null;
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

function toView(event: EventWithRelations, timeZone: string): DashboardEventView {
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
    completedOn: event.completedAt ? todayInTimeZone(timeZone, event.completedAt) : null,
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
    legacySource: event.legacySource,
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

  /**
   * Only events completed by this person, within this window.
   *
   * What a Metrics bar drills through to. It filters on *when the completion
   * happened*, not on the event's own date — "what did Nesterly finish last
   * week" is a question about the work, not about which matches are on.
   */
  completedById?: string;
  completedFrom?: PlainDate;
  completedTo?: PlainDate;

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

  if (filters.completedById) {
    where.completedById = filters.completedById;

    // The defaults above are "outstanding work": not promoted, not archived,
    // not in the past. Every one of them would hide a completed event, so a
    // drill-through would land on an empty screen while the chart it came from
    // said six. Asking about finished work means answering about finished work.
    where.status = { in: ["DASHBOARD", "C1", "COMPLETED"] };
    delete where.archivedAt;
    delete where.eventDate;
  }

  if (filters.completedFrom || filters.completedTo) {
    // Business-timezone boundaries, not UTC ones. A completion at 21:38 in
    // Caracas is 01:38 the next day in UTC, so a UTC-bounded "up to the 17th"
    // silently drops an evening's work — and the Metrics chart this drills
    // through from buckets by business date, so the two would disagree about
    // the same events. Every date boundary in this system is a business-date
    // question; this is the same rule, not a special case.
    const zone = (await getSettings()).timeZone;

    where.completedAt = {
      ...(filters.completedFrom
        ? { gte: startOfBusinessDay(filters.completedFrom, zone) }
        : {}),
      ...(filters.completedTo
        ? {
            // The instant before the following business day begins.
            lt: startOfBusinessDay(addDays(filters.completedTo, 1), zone),
          }
        : {}),
    };
  }

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
  //
  // Every ordering ends with `id`, and that is not decoration. SQL guarantees
  // nothing about the order of rows whose sort keys are equal, so any tie left
  // unbroken is free to come back differently on the next query — and this
  // screen re-queries whenever anybody ticks a box. The result was a row
  // visibly jumping a line under the cursor.
  //
  // It went unnoticed until the spreadsheet import, which inserted 615 events
  // in a single statement and gave 563 of them the same `created_at` to the
  // millisecond. Before that, creation times were naturally distinct and the
  // tie almost never arose. The ordering was always underspecified; the import
  // only made it visible.
  const stable: Prisma.EventOrderByWithRelationInput = { id: "asc" };

  const orderBy: Prisma.EventOrderByWithRelationInput[] =
    filters.sort === "eventType"
      ? [{ eventType: { name: direction } }, { eventDate: "asc" }, stable]
      : filters.sort === "assignee"
        ? [{ assignee: { displayName: direction } }, { eventDate: "asc" }, stable]
        : filters.sort === "awayTeam"
          ? [{ awayTeam: direction }, { eventDate: "asc" }, stable]
          : filters.sort === "homeTeam"
            ? [{ homeTeam: direction }, { eventDate: "asc" }, stable]
            : filters.sort === "venue"
              ? [{ venue: direction }, { eventDate: "asc" }, stable]
              : filters.sort === "createdAt"
                ? [{ createdAt: direction }, stable]
                : [{ eventDate: direction }, { createdAt: "asc" }, stable];

  const events = await prisma.event.findMany({
    where,
    include: dashboardInclude,
    orderBy,
  });

  const zone = (await getSettings()).timeZone;
  return events.map((event) => toView(event, zone));
}

export async function getEvent(eventId: string): Promise<DashboardEventView> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: dashboardInclude,
  });
  if (!event) throw notFound("That event no longer exists.");
  return toView(event, (await getSettings()).timeZone);
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

  return toView(event, (await getSettings()).timeZone);
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
): Promise<{ event: DashboardEventView }> {
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

  /*
   * Complete is a plain record of dashboard work, and nothing else.
   *
   * It does not promote, and unticking it does not demote, delete a stage or
   * move an event out of C1. The two were one act, then half an act; they are
   * now genuinely independent, which is what lets somebody correct an event
   * after ticking it — the case staleness exists to surface — without the
   * correction costing them the review work already done on it.
   *
   * That independence is why `events_c1_requires_completion_check` had to go:
   * it asserted that anything in C1 carries a completion, which stopped being
   * true the moment unticking was allowed to leave C1 alone.
   */
  if (input.complete !== undefined) {
    const isComplete = existing.completedAt !== null;

    if (input.complete && !isComplete) {
      data.completedAt = new Date();
      data.completedById = actor.effective.id;
    } else if (!input.complete && isComplete) {
      data.completedAt = null;
      data.completedById = null;
    }
  }

  // No transaction: this writes columns on a single row. It no longer moves an
  // event between screens or deletes a stage, so there is nothing left that
  // has to land together.
  if (Object.keys(data).length > 0) {
    await prisma.event.update({ where: { id: eventId }, data });
  }

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
  const completionChanged =
    input.complete !== undefined &&
    (existing.completedAt !== null) !== (event.completedAt !== null);

  if (completionChanged) {
    await recordAudit({
      ...auditActor(actor),
      entityType: "EVENT",
      entityId: eventId,
      action: event.completedAt ? "COMPLETE_CHECKED" : "COMPLETE_UNCHECKED",
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

  return { event };
}

/**
 * Sends a completed event into C1, building its review stages.
 *
 * The second half of what ticking Complete used to do in one go. Separating
 * them means the review pipeline is entered on purpose: a mis-click on a
 * checkbox no longer creates five stage rows and moves the row to another
 * screen, and an event can sit finished-but-not-submitted while somebody
 * decides, which is a state the old model could not express.
 *
 * Completion is still the precondition. An event with no completion has no
 * date to schedule its checkpoints against, and the database says the same
 * thing independently through `events_c1_requires_completion_check`.
 */
export async function sendToC1(
  eventId: string,
  actor: ActorContext,
): Promise<{ event: DashboardEventView; stagesCreated: number }> {
  const existing = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, status: true, completedAt: true, eventDate: true, archivedAt: true },
  });

  if (!existing) throw notFound("That event no longer exists.");

  if (existing.completedAt === null) {
    throw conflict("Tick Complete first — an event needs a completion before it can go to C1.");
  }

  if (existing.status === "C1") {
    throw conflict("That event is already in C1.");
  }

  if (existing.status === "CANCELLED") {
    throw conflict("That event was cancelled. Reinstate it before sending it to C1.");
  }

  if (existing.archivedAt !== null) {
    throw conflict("That event's date has passed, so there is nothing left to review.");
  }

  const eventDate = plainDateFromDbDate(existing.eventDate);

  const stagesCreated = await prisma.$transaction(async (tx) => {
    await tx.event.update({
      where: { id: eventId },
      data: { status: "C1", promotedAt: new Date() },
    });

    const created = await createStagesForEvent(tx, eventId, eventDate);

    // Sending to C1 ends a claim on the dashboard row: the work that claim
    // described is done. Released here rather than in the browser so it holds
    // however the send arrived.
    await tx.presence.deleteMany({ where: { eventId } });

    return created;
  });

  await recordAudit({
    ...auditActor(actor),
    entityType: "EVENT",
    entityId: eventId,
    action: "SENT_TO_C1",
    newValue: { stagesCreated, eventDate },
  });

  return { event: await getEvent(eventId), stagesCreated };
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
