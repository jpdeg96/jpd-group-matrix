import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import {
  clearPresenceForUser,
  heartbeat,
  listPresenceFlat,
  startPresence,
  stopPresence,
} from "@/lib/services/presence";
import { getRevisionToken } from "@/lib/services/data-revision";
import { presenceActionSchema, validationErrorIfMissingEvent } from "./helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current presence for a screen — the fallback when SSE is unavailable. */
export async function GET(request: NextRequest) {
  return handle(async () => {
    await requireUser();
    const context =
      request.nextUrl.searchParams.get("context") === "C1" ? "C1" : "DASHBOARD";

    // The revision rides along so a browser that cannot use SSE still learns
    // that shared data moved. Without it the fallback would keep presence live
    // but leave the table itself frozen, which is worse than either being
    // consistently stale.
    const [presence, revision] = await Promise.all([
      listPresenceFlat(context),
      getRevisionToken(),
    ]);

    return jsonOk({ presence, revision });
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireUser();
    const input = presenceActionSchema.parse(await readJson(request));

    switch (input.action) {
      case "START":
        await startPresence(
          validationErrorIfMissingEvent(input.eventId),
          input.context,
          actor,
        );
        break;
      case "STOP":
        await stopPresence(
          validationErrorIfMissingEvent(input.eventId),
          input.context,
          actor,
        );
        break;
      case "HEARTBEAT":
        await heartbeat(actor, input.context);
        break;
      case "CLEAR":
        await clearPresenceForUser(actor);
        break;
    }

    return jsonOk({ presence: await listPresenceFlat(input.context) });
  });
}
