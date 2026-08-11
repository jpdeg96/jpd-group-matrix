import { NextRequest } from "next/server";
import { handle, jsonOk } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import { getCompletionHistory } from "@/lib/services/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Every time Complete was ticked or unticked on this event.
 *
 * Readable by anyone who can see the event: knowing that a colleague unticked
 * something an hour ago is ordinary operational context, not privileged
 * information. The full audit log, which spans every entity, stays manager-only.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  return handle(async () => {
    await requireUser();
    const { id } = await params;
    return jsonOk({ history: await getCompletionHistory(id) });
  });
}
