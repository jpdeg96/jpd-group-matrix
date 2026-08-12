import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import { heartbeatAll, listMyPresence, stopPresence } from "@/lib/services/presence";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What *this* user is working on, anywhere.
 *
 * The per-screen endpoint answers "who is on each event on this table", which
 * cannot tell the shell what to show once you have navigated away from that
 * table. This is the inverse view, and it is what keeps a claim visible — and
 * stoppable — from Settings or Metrics.
 */
export async function GET() {
  return handle(async () => {
    const actor = await requireUser();
    return jsonOk({ presence: await listMyPresence(actor) });
  });
}

const mineActionSchema = z.discriminatedUnion("action", [
  // The heartbeat now lives in the shell rather than in either table, so it
  // must refresh claims on every screen rather than only the current one.
  // Without that, walking to Settings would let a claim quietly expire.
  z.object({ action: z.literal("HEARTBEAT") }),
  z.object({
    action: z.literal("STOP"),
    eventId: z.string().uuid(),
    context: z.enum(["DASHBOARD", "C1"]),
  }),
]);

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireUser();
    const input = mineActionSchema.parse(await readJson(request));

    if (input.action === "HEARTBEAT") {
      await heartbeatAll(actor);
    } else {
      await stopPresence(input.eventId, input.context, actor);
    }

    return jsonOk({ presence: await listMyPresence(actor) });
  });
}
