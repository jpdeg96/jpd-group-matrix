import { requirePageActor } from "@/lib/auth/guards";
import { getDashboardStats, listDashboardEvents } from "@/lib/services/events";
import { latestNotesByEvent } from "@/lib/services/notes";
import { listSelectableUsers } from "@/lib/services/users";
import { listActiveEventTypes } from "@/lib/services/event-types";
import { businessToday, getSettings } from "@/lib/services/settings";
import { isPlainDate, toPlainDate } from "@/lib/date/plain-date";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { sheetUrl } from "@/lib/services/google-sheets";

export const dynamic = "force-dynamic";

/**
 * The Event Dashboard.
 *
 * `completedBy` with a date window is a drill-through from a Metrics bar: show
 * exactly the events that person finished in that period. It deliberately
 * changes what is loaded rather than filtering the normal load, because the
 * normal load is "outstanding work" and every completed event is excluded from
 * it — filtering client-side would land on an empty screen while the chart that
 * sent you there reported six.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ completedBy?: string; from?: string; to?: string }>;
}) {
  const actor = await requirePageActor();
  const { completedBy, from, to } = await searchParams;

  const drilling = Boolean(completedBy);

  const [events, users, types, settings, today] = await Promise.all([
    drilling
      ? listDashboardEvents({
          completedById: completedBy,
          ...(isPlainDate(from) ? { completedFrom: toPlainDate(from) } : {}),
          ...(isPlainDate(to) ? { completedTo: toPlainDate(to) } : {}),
        })
      : // Promoted events stay on the dashboard as the permanent record. They
        // are loaded here and hidden behind the "Completed" chip client-side,
        // so toggling between open and completed work costs no round trip.
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

  const drilledPerson = drilling
    ? (users.find((user) => user.id === completedBy)?.displayName ?? "that person")
    : null;

  return (
    <DashboardView
      events={events}
      latestNotes={Object.fromEntries(latestNotes)}
      users={users}
      types={types}
      today={today}
      stats={stats}
      currentUser={actor.effective}
      importSheetUrl={sheetUrl(settings.importSheetId)}
      canManage={actor.effective.role !== "USER"}
      isAdmin={actor.effective.role === "ADMIN"}
      drilledFrom={
        drilledPerson
          ? {
              personName: drilledPerson,
              from: isPlainDate(from) ? toPlainDate(from) : null,
              to: isPlainDate(to) ? toPlainDate(to) : null,
            }
          : null
      }
    />
  );
}
