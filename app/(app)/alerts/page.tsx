import { requirePageActor } from "@/lib/auth/guards";
import { AlertsView } from "@/components/alerts/alerts-view";

export const dynamic = "force-dynamic";

/**
 * Flags and mentions, as a page.
 *
 * No permission gate and no data loaded here: the list is always the viewer's
 * own, fetched client-side from an endpoint that takes no recipient. Reaching
 * this page as somebody else is not a request the API can express.
 */
export default async function AlertsPage() {
  await requirePageActor();
  return <AlertsView />;
}
