import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { handle, jsonOk } from "@/lib/api/respond";
import { getSessionUser } from "@/lib/auth/guards";
import { forbidden } from "@/lib/errors";
import { runMaintenance } from "@/lib/services/maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Promotion + archival across the whole table can outrun the default budget on
// a large backlog.
export const maxDuration = 60;

/**
 * The maintenance endpoint.
 *
 * Two accepted callers, and nothing else:
 *
 *  - The scheduler, presenting `Authorization: Bearer <CRON_SECRET>`.
 *    Vercel Cron sends this header automatically when CRON_SECRET is set in the
 *    project environment.
 *  - A signed-in administrator using "Run Maintenance Now".
 *
 * With no CRON_SECRET configured the bearer path is disabled entirely rather
 * than falling open — an unauthenticated caller must never be able to drive
 * promotion and archival.
 */
async function authorize(request: NextRequest): Promise<string | null> {
  const configuredSecret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");

  if (configuredSecret && header?.startsWith("Bearer ")) {
    const presented = Buffer.from(header.slice("Bearer ".length));
    const expected = Buffer.from(configuredSecret);

    if (
      presented.length === expected.length &&
      timingSafeEqual(presented, expected)
    ) {
      return null; // System actor.
    }
  }

  const user = await getSessionUser();
  if (user?.role === "ADMIN") return user.id;

  throw forbidden("This endpoint requires the maintenance secret or an administrator.");
}

async function run(request: NextRequest) {
  return handle(async () => {
    const actorUserId = await authorize(request);
    const result = await runMaintenance({ actorUserId });
    return jsonOk(result);
  });
}

/** Vercel Cron issues GET requests. */
export async function GET(request: NextRequest) {
  return run(request);
}

/** Everything else — the standalone scheduler and the admin button — uses POST. */
export async function POST(request: NextRequest) {
  return run(request);
}
