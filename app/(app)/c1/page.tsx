import { requirePageActor } from "@/lib/auth/guards";
import { getC1Stats, listC1Rows } from "@/lib/services/stages";
import { listSelectableUsers } from "@/lib/services/users";
import { listActiveEventTypes } from "@/lib/services/event-types";
import { businessToday, getSettings } from "@/lib/services/settings";
import { isPlainDate, toPlainDate } from "@/lib/date/plain-date";
import { latestNotesByEvent } from "@/lib/services/notes";
import { C1View } from "@/components/c1/c1-view";

export const dynamic = "force-dynamic";

export default async function C1Page({
  searchParams,
}: {
  searchParams: Promise<{ stageDoneBy?: string; from?: string; to?: string }>;
}) {
  const actor = await requirePageActor();
  const { stageDoneBy, from, to } = await searchParams;

  const [users, types, settings, today] = await Promise.all([
    listSelectableUsers(),
    listActiveEventTypes(),
    getSettings(),
    businessToday(),
  ]);

  // Overdue rows are excluded from C1 by request. They still exist and are
  // still worked — the header reports how many are hidden so they are not
  // silently lost.
  const [rows, stats] = await Promise.all([
    // Arriving from a Metrics bar asks a different question — "what did this
    // person review" — so the default overdue trim does not apply: it would
    // hide work they demonstrably did.
    stageDoneBy
      ? listC1Rows({
          today,
          stageDoneById: stageDoneBy,
          ...(isPlainDate(from) ? { stageDoneFrom: toPlainDate(from) } : {}),
          ...(isPlainDate(to) ? { stageDoneTo: toPlainDate(to) } : {}),
        })
      : listC1Rows({ hideOverdue: true, today }),
    getC1Stats(actor.effective.id, today),
  ]);

  // Notes belong to the event, not to a screen, so a note left on the
  // Dashboard is already attached to the row that arrives here. This fetches
  // the newest one per event so the cell shows it without a second request.
  const latestNotes = await latestNotesByEvent(rows.map((row) => row.eventId));

  return (
    <C1View
      rows={rows}
      latestNotes={Object.fromEntries(latestNotes)}
      users={users}
      types={types}
      today={today}
      stats={stats}
      offsets={settings.reviewOffsets}
      currentUser={actor.effective}
      canAssign={actor.effective.role !== "USER"}
      // Review dates are the deadline everything else is measured against, so
      // both the per-row picker and the bulk tool are administrator-only.
      canEditDueDates={actor.effective.role === "ADMIN"}
    />
  );
}
