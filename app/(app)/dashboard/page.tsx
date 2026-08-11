import { requirePageActor } from "@/lib/auth/guards";
import { getDashboardStats, listDashboardEvents } from "@/lib/services/events";
import { latestNotesByEvent } from "@/lib/services/notes";
import { listSelectableUsers } from "@/lib/services/users";
import { listActiveEventTypes } from "@/lib/services/event-types";
import { businessToday, getSettings } from "@/lib/services/settings";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const actor = await requirePageActor();

  const [events, users, types, settings, today] = await Promise.all([
    // Promoted events stay on the dashboard as the permanent record. They are
    // loaded here and hidden behind the "Completed" chip client-side, so
    // toggling between open and completed work costs no round trip.
    listDashboardEvents({ includePromoted: true }),
    listSelectableUsers(),
    listActiveEventTypes(),
    getSettings(),
    businessToday(),
  ]);

  const [stats, latestNotes] = await Promise.all([
    getDashboardStats(actor.effective.id),
    latestNotesByEvent(events.map((event) => event.id)),
  ]);

  return (
    <DashboardView
      events={events}
      latestNotes={Object.fromEntries(latestNotes)}
      users={users}
      types={types}
      today={today}
      stats={stats}
      currentUser={actor.effective}
      canManage={actor.effective.role !== "USER"}
      isAdmin={actor.effective.role === "ADMIN"}
      linkOptions={{
        seatGeek: settings.seatGeekLinksEnabled,
        stubHub: settings.stubHubLinksEnabled,
      }}
    />
  );
}
