import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import {
  clearNotifications,
  listNotifications,
  markRead,
} from "@/lib/services/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What this person needs to look at.
 *
 * Always scoped to the session — there is no recipient parameter, so no request
 * can ask for somebody else's bell.
 */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const actor = await requireUser();
    const unreadOnly = request.nextUrl.searchParams.get("unread") === "true";
    return jsonOk(await listNotifications(actor, { unreadOnly }));
  });
}

const actionSchema = z.union([
  z.object({ action: z.literal("READ_ALL") }),
  z.object({ action: z.literal("READ"), ids: z.array(z.string().uuid()).min(1) }),
  // Clearing removes them; marking read only says they have been seen. On a
  // bell somebody checks constantly, a read pile still costs a scroll.
  z.object({ action: z.literal("CLEAR") }),
]);

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireUser();
    const input = actionSchema.parse(await readJson(request));

    if (input.action === "CLEAR") {
      await clearNotifications(actor);
    } else {
      await markRead(actor, input.action === "READ_ALL" ? "ALL" : input.ids);
    }

    return jsonOk(await listNotifications(actor));
  });
}
