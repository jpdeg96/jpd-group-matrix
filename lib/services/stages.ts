/**
 * C1 staging.
 *
 * An event in C1 is a single row showing its *current* review stage — the
 * furthest-out one still pending. Ticking Done resolves that stage and the row
 * immediately becomes the next one, with a freshly calculated Review Due. When
 * no pending stages remain the event leaves C1 altogether.
 *
 * All stage rows exist from the moment of promotion; only one is ever
 * displayed. Keeping the resolved ones is what makes per-person productivity
 * reporting possible later.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  addDays,
  dbDateFromPlainDate,
  plainDateFromDbDate,
  toPlainDate,
  type PlainDate,
} from "@/lib/date/plain-date";
import {
  currentStage,
  stageProgress,
  stageScheduleDrift,
  type ScheduleConfig,
} from "@/lib/domain/review-schedule";
import { businessToday, getScheduleConfig, getSettings } from "./settings";
import { startOfBusinessDay } from "./clockify";
import { conflict, forbidden, notFound, validationError } from "@/lib/errors";
import { canAdminister } from "@/lib/domain/constants";
import { assertCanAssign, auditActor, type ActorContext } from "@/lib/auth/actor";
import { recordAudit } from "./audit";

export interface C1RowView {
  eventId: string;
  eventDate: PlainDate;
  eventTypeId: string;
  eventTypeName: string;
  eventTypeEmoji: string | null;
  awayTeam: string | null;
  homeTeam: string | null;
  venue: string | null;
  /** Set when the event was imported rather than created here. */
  legacySource: string | null;

  /** The stage currently on show. */
  stageId: string;
  offsetDays: number;
  reviewDue: PlainDate;
  reviewDueOverridden: boolean;
  /** What the schedule would give for the event's current date. */
  expectedReviewDue: PlainDate;
  /**
   * The stored date no longer matches the formula, and was not hand-set —
   * almost always because the event date moved after promotion.
   */
  scheduleDrifted: boolean;

  assigneeId: string | null;
  assigneeName: string | null;
  assigneeColor: string | null;

  /** Always false for a displayed row — a done stage is replaced by the next. */
  done: boolean;
  doneAt: string | null;

  /** Progress through the whole stage list, e.g. 2 resolved of 5. */
  resolvedStages: number;
  totalStages: number;
  noteCount: number;

  flaggedAt: string | null;
  flaggedByName: string | null;
  flagReason: string | null;
  flagFixedAt: string | null;
  flagFixedByName: string | null;
}

const c1Include = {
  eventType: { select: { id: true, name: true, emoji: true } },
  flaggedBy: { select: { displayName: true } },
  flagFixedBy: { select: { displayName: true } },
  stages: {
    select: {
      id: true,
      offsetDays: true,
      reviewDue: true,
      reviewDueOverridden: true,
      status: true,
      doneAt: true,
      assigneeId: true,
      assignee: { select: { displayName: true, color: true } },
    },
  },
  _count: { select: { notes: true } },
} satisfies Prisma.EventInclude;

type C1Event = Prisma.EventGetPayload<{ include: typeof c1Include }>;

function toRow(event: C1Event, config: ScheduleConfig): C1RowView | null {
  const stage = currentStage(event.stages);
  if (!stage) return null;

  const progress = stageProgress(event.stages);
  const eventDate = plainDateFromDbDate(event.eventDate);
  const reviewDue = plainDateFromDbDate(stage.reviewDue);

  const drift = stageScheduleDrift(
    {
      offsetDays: stage.offsetDays,
      reviewDue,
      reviewDueOverridden: stage.reviewDueOverridden,
      status: stage.status,
    },
    eventDate,
    config,
  );

  return {
    eventId: event.id,
    eventDate,
    eventTypeId: event.eventType.id,
    eventTypeName: event.eventType.name,
    eventTypeEmoji: event.eventType.emoji,
    awayTeam: event.awayTeam,
    homeTeam: event.homeTeam,
    venue: event.venue,
    legacySource: event.legacySource,
    stageId: stage.id,
    offsetDays: stage.offsetDays,
    reviewDue,
    reviewDueOverridden: stage.reviewDueOverridden,
    expectedReviewDue: drift.expected,
    scheduleDrifted: drift.drifted,
    assigneeId: stage.assigneeId,
    assigneeName: stage.assignee?.displayName ?? null,
    assigneeColor: stage.assignee?.color ?? null,
    done: false,
    doneAt: stage.doneAt?.toISOString() ?? null,
    resolvedStages: progress.resolved,
    totalStages: progress.total,
    noteCount: event._count.notes,
    flaggedAt: event.flaggedAt?.toISOString() ?? null,
    flaggedByName: event.flaggedBy?.displayName ?? null,
    flagReason: event.flagReason,
    flagFixedAt: event.flagFixedAt?.toISOString() ?? null,
    flagFixedByName: event.flagFixedBy?.displayName ?? null,
  };
}

export interface C1Filters {
  search?: string;
  eventTypeId?: string;
  assigneeId?: string;
  stageOffset?: number;
  dueFrom?: PlainDate;
  dueTo?: PlainDate;
  /**
   * Hide rows whose review date has already passed.
   *
   * Requires `today`. Overdue rows still exist and are still worked — they are
   * simply not shown in the default C1 view.
   */
  hideOverdue?: boolean;
  today?: PlainDate;
}

/**
 * C1 rows, most urgent first.
 *
 * Sorting is done in application code because the sort key is the *current*
 * stage's due date, which depends on which stages are still pending — not
 * something a single ORDER BY can express. The working set is small enough that
 * this is cheaper than the query gymnastics required to push it into SQL.
 */
export async function listC1Rows(filters: C1Filters = {}): Promise<C1RowView[]> {
  const cutoff = filters.today ?? (await businessToday());

  const where: Prisma.EventWhereInput = {
    status: "C1",
    // Once the event itself has happened there is nothing left to stage for, so
    // it leaves C1 alongside the Dashboard. Same belt-and-braces as there: the
    // date predicate is immediate, the archive flag makes it durable.
    archivedAt: null,
    eventDate: { gte: dbDateFromPlainDate(cutoff) },
  };

  if (filters.eventTypeId) where.eventTypeId = filters.eventTypeId;

  if (filters.search) {
    const contains = filters.search;
    where.OR = [
      { awayTeam: { contains, mode: "insensitive" } },
      { homeTeam: { contains, mode: "insensitive" } },
      { venue: { contains, mode: "insensitive" } },
      { eventType: { name: { contains, mode: "insensitive" } } },
    ];
  }

  const [events, config] = await Promise.all([
    prisma.event.findMany({ where, include: c1Include }),
    getScheduleConfig(),
  ]);

  let rows = events
    .map((event) => toRow(event, config))
    .filter((row): row is C1RowView => row !== null);

  if (filters.assigneeId) {
    rows = rows.filter((row) =>
      filters.assigneeId === "UNASSIGNED"
        ? row.assigneeId === null
        : row.assigneeId === filters.assigneeId,
    );
  }

  if (filters.stageOffset !== undefined) {
    rows = rows.filter((row) => row.offsetDays === filters.stageOffset);
  }

  if (filters.dueFrom) rows = rows.filter((row) => row.reviewDue >= filters.dueFrom!);
  if (filters.dueTo) rows = rows.filter((row) => row.reviewDue <= filters.dueTo!);

  if (filters.hideOverdue && filters.today) {
    rows = rows.filter((row) => row.reviewDue >= filters.today!);
  }

  // Ends on the stage id for the same reason the dashboard ordering ends on the
  // event id: two rows that tie on every visible key must still come back in
  // the same order every time, or they swap places on any re-query and a row
  // appears to jump a line while somebody is working it.
  return rows.sort(
    (a, b) =>
      a.reviewDue.localeCompare(b.reviewDue) ||
      a.eventDate.localeCompare(b.eventDate) ||
      b.offsetDays - a.offsetDays ||
      a.stageId.localeCompare(b.stageId),
  );
}

export interface UpdateStageInput {
  assigneeId?: string | null;
  reviewDue?: PlainDate;
  done?: boolean;
}

/**
 * Updates the current stage.
 *
 * Ticking `done` resolves this stage; the row then re-renders as the next
 * pending stage. If none remain the event moves to COMPLETED and drops out of
 * C1 entirely.
 */
export async function updateStage(
  stageId: string,
  input: UpdateStageInput,
  actor: ActorContext,
): Promise<{ advanced: boolean; eventCompleted: boolean; eventId: string }> {
  const existing = await prisma.reviewStage.findUnique({
    where: { id: stageId },
    select: {
      id: true,
      eventId: true,
      offsetDays: true,
      status: true,
      assigneeId: true,
      reviewDue: true,
      doneAt: true,
      event: { select: { status: true } },
    },
  });
  if (!existing) throw notFound("That review stage no longer exists.");

  if (existing.event.status === "CANCELLED") {
    throw conflict("This event has been cancelled.");
  }

  if (existing.status === "SKIPPED") {
    throw conflict(
      "This stage was already past its deadline when the event reached C1, so it cannot be actioned.",
    );
  }

  const data: Prisma.ReviewStageUncheckedUpdateInput = {};

  if (input.assigneeId !== undefined) {
    assertCanAssign(actor, existing.assigneeId, input.assigneeId);
    await assertAssignable(input.assigneeId, existing.assigneeId);
    data.assigneeId = input.assigneeId;
  }

  if (input.reviewDue !== undefined) {
    // Administrators only. A review date is the deadline the whole staging
    // process is measured against — moving it silently reshapes what counts as
    // late, so it sits above the level that does the work.
    if (!canAdminister(actor.effective.role)) {
      throw forbidden(
        "Only administrators can change a review due date. Raise a flag if one needs moving.",
      );
    }

    // A hand-set date is marked so nothing recalculates over it later.
    data.reviewDue = dbDateFromPlainDate(toPlainDate(input.reviewDue));
    data.reviewDueOverridden = true;
  }

  let advanced = false;

  if (input.done !== undefined) {
    const isDone = existing.status === "DONE";

    if (input.done && !isDone) {
      // Status and timestamp move together — the database CHECK constraint
      // enforces that a DONE stage always has a completion instant.
      data.status = "DONE";
      data.doneAt = new Date();
      data.doneById = actor.effective.id;
      advanced = true;
    } else if (!input.done && isDone) {
      data.status = "PENDING";
      data.doneAt = null;
      data.doneById = null;
    }
  }

  let eventCompleted = false;

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.reviewStage.update({ where: { id: stageId }, data });
    }

    const remaining = await tx.reviewStage.count({
      where: { eventId: existing.eventId, status: "PENDING" },
    });

    // The event's presence in C1 is derived from whether pending stages remain,
    // so re-opening a stage brings it back automatically.
    if (remaining === 0) {
      await tx.event.update({
        where: { id: existing.eventId },
        data: { status: "COMPLETED" },
      });
      eventCompleted = true;
    } else {
      await tx.event.updateMany({
        where: { id: existing.eventId, status: "COMPLETED" },
        data: { status: "C1" },
      });
    }
  });

  await recordAudit({
    ...auditActor(actor),
    entityType: "REVIEW_STAGE",
    entityId: stageId,
    action: advanced ? "STAGE_DONE" : "UPDATED",
    newValue: { ...input, offsetDays: existing.offsetDays },
  });

  return { advanced, eventCompleted, eventId: existing.eventId };
}

export interface BulkDueInput {
  stageIds: string[];
  /** Set every selected stage to this exact date. */
  reviewDue?: PlainDate;
  /** Or shift each one by this many days, preserving their spacing. */
  shiftDays?: number;
}

export interface BulkDueResult {
  updated: number;
  skipped: number;
}

/**
 * Rewrites the review date on many stages at once.
 *
 * Two modes because they answer different questions: "everything moves to this
 * date" (a fixed deadline) and "everything slips by N days" (a schedule shift,
 * which preserves the spacing between stages).
 *
 * Both mark the rows as manually overridden, so nothing recalculates over them
 * later. Resolved stages are skipped rather than rewritten — a completed review
 * happened on the date it happened, and moving it would falsify the record.
 */
export async function bulkUpdateReviewDue(
  input: BulkDueInput,
  actor: ActorContext,
): Promise<BulkDueResult> {
  // Same rule as the single-row edit, enforced here as well as at the route:
  // a bulk move is the higher-consequence version of the same action.
  if (!canAdminister(actor.effective.role)) {
    throw forbidden("Only administrators can change review due dates.");
  }

  if (input.stageIds.length === 0) {
    throw validationError("Select at least one row first.");
  }
  if (input.reviewDue === undefined && input.shiftDays === undefined) {
    throw validationError("Choose a new date or a number of days to shift by.");
  }

  const stages = await prisma.reviewStage.findMany({
    where: { id: { in: input.stageIds } },
    select: { id: true, status: true, reviewDue: true, offsetDays: true },
  });

  const actionable = stages.filter((stage) => stage.status === "PENDING");
  if (actionable.length === 0) {
    throw conflict("None of the selected rows are still pending.");
  }

  const updates = actionable.map((stage) => {
    const next =
      input.reviewDue !== undefined
        ? input.reviewDue
        : addDays(plainDateFromDbDate(stage.reviewDue), input.shiftDays!);

    return prisma.reviewStage.update({
      where: { id: stage.id },
      data: {
        reviewDue: dbDateFromPlainDate(next),
        reviewDueOverridden: true,
      },
    });
  });

  // One transaction: a partly applied bulk edit is worse than none, because
  // nobody can tell which half moved.
  await prisma.$transaction(updates);

  await recordAudit({
    ...auditActor(actor),
    entityType: "REVIEW_STAGE",
    entityId: "00000000-0000-0000-0000-000000000000",
    action: "BULK_REVIEW_DUE",
    newValue: {
      stageIds: actionable.map((stage) => stage.id),
      reviewDue: input.reviewDue ?? null,
      shiftDays: input.shiftDays ?? null,
    },
  });

  return {
    updated: actionable.length,
    skipped: stages.length - actionable.length,
  };
}

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

/**
 * Header counters for C1.
 *
 * No overdue count: a stage only moves when someone ticks Done, so a passed
 * review date is an ordinary state rather than an alarm, and a permanent red
 * number would train people to ignore it.
 */
export async function getC1Stats(userId: string, today: PlainDate) {
  const rows = await listC1Rows();
  const visible = rows.filter((row) => row.reviewDue >= today);

  return {
    // Counts describe the rows actually on screen, so the header agrees with
    // the table rather than quietly including hidden overdue work.
    total: visible.length,
    dueToday: visible.filter((row) => row.reviewDue === today).length,
    unassigned: visible.filter((row) => row.assigneeId === null).length,
    mine: visible.filter((row) => row.assigneeId === userId).length,
    flagged: visible.filter((row) => row.flaggedAt !== null).length,
    /** Hidden from the table, but surfaced as a count so it is not invisible. */
    hiddenOverdue: rows.length - visible.length,
  };
}

/**
 * Full stage history for one event — every stage with its status, owner and
 * completion instant.
 *
 * This is the reporting surface that replaces the removed Archive tab: the data
 * is all still here, it simply is not a browsable screen.
 */
export async function getEventStageHistory(eventId: string) {
  const stages = await prisma.reviewStage.findMany({
    where: { eventId },
    orderBy: { offsetDays: "desc" },
    select: {
      id: true,
      offsetDays: true,
      reviewDue: true,
      status: true,
      doneAt: true,
      assignee: { select: { displayName: true, color: true } },
      doneBy: { select: { displayName: true } },
    },
  });

  return stages.map((stage) => ({
    id: stage.id,
    offsetDays: stage.offsetDays,
    reviewDue: plainDateFromDbDate(stage.reviewDue),
    status: stage.status,
    doneAt: stage.doneAt?.toISOString() ?? null,
    assigneeName: stage.assignee?.displayName ?? null,
    assigneeColor: stage.assignee?.color ?? null,
    doneByName: stage.doneBy?.displayName ?? null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Completed review work                                                      */
/* -------------------------------------------------------------------------- */

export interface CompletedStageView {
  stageId: string;
  eventId: string;
  eventDate: PlainDate;
  eventTypeName: string;
  eventTypeEmoji: string | null;
  awayTeam: string | null;
  homeTeam: string | null;
  venue: string | null;
  /** Which checkpoint it was — 21, 14, 7 and so on. */
  offsetDays: number;
  reviewDue: PlainDate;
  doneAt: string;
  doneByName: string | null;
  doneByColor: string | null;
  /** Where the event ended up, so a finished one is not mistaken for live work. */
  eventStatus: "DASHBOARD" | "C1" | "COMPLETED" | "CANCELLED";
  legacySource: string | null;
}

/**
 * Review checkpoints somebody actually ticked off, newest first.
 *
 * Deliberately *not* a variant of `listC1Rows`. That function answers "what is
 * outstanding": it shows one row per event, on its current pending stage, and
 * an event whose stages are all done has left C1 entirely. Ticking off review
 * work is precisely what removes an event from that list, so asking it "which
 * stages did this person complete" returns nothing — which is what the Metrics
 * drill-through hit.
 *
 * This asks the opposite question and so has the opposite shape: one row per
 * completed stage, keyed to the stage rather than the event, with no filter on
 * the event's current status. An event that finished last month is exactly the
 * kind of thing this should show.
 */
export async function listCompletedStages(filters: {
  doneById?: string;
  from?: PlainDate;
  to?: PlainDate;
  limit?: number;
}): Promise<CompletedStageView[]> {
  const zone = (await getSettings()).timeZone;

  const stages = await prisma.reviewStage.findMany({
    where: {
      status: "DONE",
      doneAt: {
        not: null,
        ...(filters.from ? { gte: startOfBusinessDay(filters.from, zone) } : {}),
        ...(filters.to ? { lt: startOfBusinessDay(addDays(filters.to, 1), zone) } : {}),
      },
      ...(filters.doneById ? { doneById: filters.doneById } : {}),
    },
    select: {
      id: true,
      offsetDays: true,
      reviewDue: true,
      doneAt: true,
      doneBy: { select: { displayName: true, color: true } },
      event: {
        select: {
          id: true,
          eventDate: true,
          status: true,
          venue: true,
          awayTeam: true,
          homeTeam: true,
          legacySource: true,
          eventType: { select: { name: true, emoji: true } },
        },
      },
    },
    // Newest first: "what did I get through" is read from the top down. The
    // stage id breaks ties so the order is total, for the same reason every
    // other listing here ends on an id.
    orderBy: [{ doneAt: "desc" }, { id: "asc" }],
    take: filters.limit ?? 500,
  });

  return stages.map((stage) => ({
    stageId: stage.id,
    eventId: stage.event.id,
    eventDate: plainDateFromDbDate(stage.event.eventDate),
    eventTypeName: stage.event.eventType.name,
    eventTypeEmoji: stage.event.eventType.emoji,
    awayTeam: stage.event.awayTeam,
    homeTeam: stage.event.homeTeam,
    venue: stage.event.venue,
    offsetDays: stage.offsetDays,
    reviewDue: plainDateFromDbDate(stage.reviewDue),
    // Non-null by the query: a DONE stage without a timestamp is refused by
    // `review_stages_done_coherent_check`.
    doneAt: stage.doneAt!.toISOString(),
    doneByName: stage.doneBy?.displayName ?? null,
    doneByColor: stage.doneBy?.color ?? null,
    eventStatus: stage.event.status,
    legacySource: stage.event.legacySource,
  }));
}
