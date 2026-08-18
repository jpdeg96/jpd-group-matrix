import { NextRequest } from "next/server";
import { handle, jsonOk } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import { canAssignOthers } from "@/lib/domain/constants";
import { getMetrics } from "@/lib/services/metrics";
import { isMetricsPeriod } from "@/lib/domain/metrics-period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Aggregated user metrics.
 *
 * Everyone may read their own; managers and administrators may read everyone's.
 *
 * The scope is decided here from the session, never from a request parameter.
 * A `userId` in the query string would be a request to be trusted about who you
 * are, and the whole point of the restriction is that it cannot be asked for.
 * The page applies the same rule independently — this is the boundary that
 * actually enforces it, since the page can be bypassed by calling the route.
 */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const actor = await requireUser();

    const raw = request.nextUrl.searchParams.get("period");
    const period = isMetricsPeriod(raw) ? raw : "THIS_WEEK";

    const metrics = await getMetrics(
      period,
      canAssignOthers(actor.effective.role) ? {} : { onlyUserId: actor.effective.id },
    );

    return jsonOk({ metrics });
  });
}
