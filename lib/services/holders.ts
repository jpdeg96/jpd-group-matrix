/**
 * Who holds an event, on each screen.
 *
 * An event has two assignees and they are genuinely different people often
 * enough to matter: the Dashboard assignee prepares it, and the assignee on its
 * current review stage reviews it in C1. The C1 "Assigned" column shows the
 * second. Permission checks that consulted only the first refused people on
 * the very rows the screen told them were theirs — every C1 row whose reviewer
 * was not also its Dashboard assignee.
 *
 * Resolved here, once, so no caller has to know which field a screen means.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { currentStage } from "@/lib/domain/review-schedule";

export interface EventHolders {
  /** The Dashboard assignee — who is preparing the event. */
  eventAssigneeId: string | null;
  /**
   * The assignee on the review stage C1 is currently showing, or null when the
   * stage is unclaimed or the event has no pending stage.
   */
  stageAssigneeId: string | null;
}

/**
 * Null when the event does not exist.
 *
 * Uses the same `currentStage` rule as the C1 table itself, so the stage whose
 * assignee is checked is always the stage whose assignee is displayed.
 */
export async function loadHolders(
  eventId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<(EventHolders & { completedAt: Date | null }) | null> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: {
      assigneeId: true,
      completedAt: true,
      stages: { select: { offsetDays: true, status: true, assigneeId: true } },
    },
  });
  if (!event) return null;

  return {
    eventAssigneeId: event.assigneeId,
    stageAssigneeId: currentStage(event.stages)?.assigneeId ?? null,
    completedAt: event.completedAt,
  };
}
