/**
 * Scheduled housekeeping.
 *
 * Much smaller than it used to be. Promotion is now a deliberate human act —
 * ticking Complete — so there is no longer a job that moves work along on a
 * timer. What remains is genuine maintenance.
 *
 * Everything here is idempotent and safe to run as often as you like.
 */

import { prisma } from "@/lib/db/prisma";
import { dbDateFromPlainDate, type PlainDate } from "@/lib/date/plain-date";
import { businessToday } from "./settings";
import { sweepExpiredPresence } from "./presence";
import { recordAudit } from "./audit";

export interface MaintenanceResult {
  today: PlainDate;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Stale "in progress" flags removed. */
  presenceCleared: number;
  /** Events archived because their date has passed. */
  eventsArchived: number;
  /** C1 stages past their review due date and still pending. */
  overdueStages: number;
}

/**
 * Archives events whose date has passed.
 *
 * They leave both the Dashboard and C1 but keep every note, stage and
 * completion record — that history is the productivity data, and deleting the
 * row would take it with them.
 *
 * The screens already exclude past events by date, so this is not what makes
 * them disappear; it makes the state explicit and countable rather than an
 * implicit property of every query. Idempotent: only rows not already archived
 * are touched.
 */
export async function archivePastEvents(today?: PlainDate): Promise<number> {
  const cutoff = today ?? (await businessToday());

  const result = await prisma.event.updateMany({
    where: {
      archivedAt: null,
      eventDate: { lt: dbDateFromPlainDate(cutoff) },
    },
    data: { archivedAt: new Date() },
  });

  return result.count;
}

/**
 * Counts work that has slipped, for reporting only.
 *
 * Overdue C1 stages are surfaced rather than tidied away: a stage only moves
 * when somebody ticks Done, so the job's role is to make the backlog visible,
 * not to resolve it on anyone's behalf.
 */
async function countSlippage(today: PlainDate) {
  const overdueStages = await prisma.reviewStage.count({
    where: {
      status: "PENDING",
      reviewDue: { lt: dbDateFromPlainDate(today) },
      event: { status: "C1", archivedAt: null },
    },
  });

  return { overdueStages };
}

export async function runMaintenance(
  options: { actorUserId?: string | null } = {},
): Promise<MaintenanceResult> {
  const startedAt = new Date();
  const today = await businessToday(startedAt);

  const presenceCleared = await sweepExpiredPresence();
  const eventsArchived = await archivePastEvents(today);
  const { overdueStages } = await countSlippage(today);

  const finishedAt = new Date();

  const result: MaintenanceResult = {
    today,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    presenceCleared,
    eventsArchived,
    overdueStages,
  };

  console.info("[maintenance] completed", result);

  // Only record runs that changed something, so the audit log stays a record of
  // change rather than a log of hourly no-ops.
  if (presenceCleared > 0 || eventsArchived > 0) {
    await recordAudit({
      userId: options.actorUserId ?? null,
      entityType: "MAINTENANCE",
      entityId: "00000000-0000-0000-0000-000000000000",
      action: "RUN",
      newValue: { presenceCleared, eventsArchived, overdueStages },
    });
  }

  return result;
}
