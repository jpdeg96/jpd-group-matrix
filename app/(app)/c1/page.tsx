import { requireUser } from "@/lib/auth/guards";
import { getC1Stats, listC1Rows } from "@/lib/services/stages";
import { listSelectableUsers } from "@/lib/services/users";
import { listActiveEventTypes } from "@/lib/services/event-types";
import { businessToday, getSettings } from "@/lib/services/settings";
import { C1View } from "@/components/c1/c1-view";

export const dynamic = "force-dynamic";

export default async function C1Page() {
  const actor = await requireUser();

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
    listC1Rows({ hideOverdue: true, today }),
    getC1Stats(actor.effective.id, today),
  ]);

  return (
    <C1View
      rows={rows}
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
      linkOptions={{
        seatGeek: settings.seatGeekLinksEnabled,
        stubHub: settings.stubHubLinksEnabled,
      }}
    />
  );
}
