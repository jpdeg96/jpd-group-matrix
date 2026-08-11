import { NextRequest } from "next/server";
import { handle, jsonOk } from "@/lib/api/respond";
import { requireManager } from "@/lib/auth/guards";
import { getMetrics } from "@/lib/services/metrics";
import { isMetricsPeriod } from "@/lib/domain/metrics-period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Aggregated user metrics.
 *
 * Manager and above: this is per-person productivity data, which is not
 * something the people being measured should be browsing about each other.
 */
export async function GET(request: NextRequest) {
  return handle(async () => {
    await requireManager();

    const raw = request.nextUrl.searchParams.get("period");
    const period = isMetricsPeriod(raw) ? raw : "THIS_WEEK";

    return jsonOk({ metrics: await getMetrics(period) });
  });
}
