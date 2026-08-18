import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import { canAssignOthers } from "@/lib/domain/constants";
import { getMetrics } from "@/lib/services/metrics";
import { isMetricsPeriod } from "@/lib/domain/metrics-period";
import { MetricsView } from "@/components/metrics/metrics-view";

export const dynamic = "force-dynamic";

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const actor = await getActorContext();
  if (!actor) redirect("/sign-in");

  // Everyone can see their own figures; only managers and administrators see
  // anybody else's. The scoping happens in the query rather than in what gets
  // rendered, so another person's numbers are never computed or sent — there
  // is nothing to read out of the response.
  const seesEveryone = canAssignOthers(actor.effective.role);

  const { period } = await searchParams;
  const metrics = await getMetrics(
    isMetricsPeriod(period) ? period : "THIS_WEEK",
    seesEveryone ? {} : { onlyUserId: actor.effective.id },
  );

  return <MetricsView initial={metrics} scopedToSelf={!seesEveryone} />;
}
