import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import { markFlagFixed } from "@/lib/services/events";
import { flagEventSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * "I have dealt with this."
 *
 * Marks a flag ready for a manager to check. Deliberately separate from
 * clearing it — the person who fixes a problem is not the person who signs it
 * off, and one endpoint doing both would let a flag be closed by the account
 * that caused it.
 *
 * Reuses the flag schema: the optional `reason` here is what they did about it,
 * which travels to the manager with the notification.
 */
export async function POST(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await params;
    const { reason } = flagEventSchema.parse(await readJson(request));
    return jsonOk({ event: await markFlagFixed(id, reason ?? null, actor) });
  });
}
