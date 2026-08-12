import { handle, jsonOk } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import { getTodayProgress } from "@/lib/services/today-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * This person's own progress today: completions, and hours worked.
 *
 * Deliberately scoped to the caller. Per-person productivity is a
 * manager-and-above view everywhere else, and this endpoint exists only so the
 * browser can decide whether to celebrate — it must not become a way for anyone
 * to read anyone else's numbers.
 */
export async function GET() {
  return handle(async () => {
    const actor = await requireUser();
    return jsonOk({ progress: await getTodayProgress(actor) });
  });
}
