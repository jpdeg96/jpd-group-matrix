import { NextRequest } from "next/server";
import { handle, jsonOk } from "@/lib/api/respond";
import { requireManager } from "@/lib/auth/guards";
import { listAuditLog } from "@/lib/services/audit-log";
import { auditQuerySchema, searchParamsToObject } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The audit trail.
 *
 * Manager and above: it exposes who did what across every event, which is not
 * something a regular user should be able to browse.
 */
export async function GET(request: NextRequest) {
  return handle(async () => {
    await requireManager();

    const query = auditQuerySchema.parse(
      searchParamsToObject(request.nextUrl.searchParams),
    );

    return jsonOk(await listAuditLog(query));
  });
}
