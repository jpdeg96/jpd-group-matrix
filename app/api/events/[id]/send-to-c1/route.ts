import { NextRequest } from "next/server";
import { handle, jsonOk } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import { sendToC1 } from "@/lib/services/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends a completed event into C1.
 *
 * Open to everyone signed in, like ticking Complete. This is a step in the
 * normal flow of the work rather than an administrative act — restricting it
 * would leave whoever finished an event waiting on somebody else to press a
 * button on their behalf.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await context.params;

    return jsonOk(await sendToC1(id, actor));
  });
}
