import { requirePageActor } from "@/lib/auth/guards";
import { can } from "@/lib/auth/actor";
import { prisma } from "@/lib/db/prisma";
import { isPushConfigured } from "@/lib/services/push";
import { AlertsView } from "@/components/alerts/alerts-view";

export const dynamic = "force-dynamic";

/**
 * Flags and mentions, as a page.
 *
 * The list itself is loaded client-side from an endpoint that takes no
 * recipient, so there is no request shape that asks for somebody else's — which
 * is why this page has no permission gate on the notifications themselves.
 *
 * The clock preference is read here rather than fetched, so the switch renders
 * in the position it is actually in instead of flicking across on arrival.
 */
export default async function AlertsPage() {
  const actor = await requirePageActor();

  const mayHearClockEvents = can(actor, "clock.notify");

  const me = mayHearClockEvents
    ? await prisma.user.findUnique({
        where: { id: actor.effective.id },
        select: { pushClockEvents: true },
      })
    : null;

  return (
    <AlertsView
      // Offered only when the role may be told at all *and* this server can
      // actually send — a switch for something that cannot happen is worse
      // than no switch.
      clockPreference={
        mayHearClockEvents && isPushConfigured()
          ? { enabled: me?.pushClockEvents ?? true }
          : null
      }
    />
  );
}
