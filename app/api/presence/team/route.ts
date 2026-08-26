import { handle, jsonOk } from "@/lib/api/respond";
import { requireRole } from "@/lib/auth/guards";
import { listTeamPresence } from "@/lib/services/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who on the team is working on what, right now.
 *
 * Managers and above. The role is checked here rather than trusted from the
 * caller — the widget hides itself for a regular user, but hiding a control is
 * a courtesy and this is the actual boundary.
 */
export async function GET() {
  return handle(async () => {
    await requireRole("MANAGER");
    return jsonOk({ presence: await listTeamPresence() });
  });
}
