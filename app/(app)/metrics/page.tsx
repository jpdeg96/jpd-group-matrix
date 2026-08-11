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
  // Per-person productivity data — not something the people being measured
  // should be browsing about one another.
  if (!canAssignOthers(actor.effective.role)) redirect("/dashboard");

  const { period } = await searchParams;
  const metrics = await getMetrics(isMetricsPeriod(period) ? period : "THIS_WEEK");

  return <MetricsView initial={metrics} />;
}
