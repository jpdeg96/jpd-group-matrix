import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { handle, jsonOk } from "@/lib/api/respond";
import { getActorContext } from "@/lib/auth/guards";
import { can } from "@/lib/auth/actor";
import { forbidden } from "@/lib/errors";
import { runClockWatch } from "@/lib/services/clock-watch";
import { acquireLease } from "@/lib/services/lease";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A dozen sequential Clockify calls, each with its own timeout.
export const maxDuration = 60;

const LEASE = "clock-watch";

/**
 * Held for several times the polling interval, so a tick that overruns keeps
 * its claim rather than letting another instance start the same work alongside
 * it. An expiry rather than an explicit release, so a process killed mid-tick
 * does not hold the job shut until somebody notices.
 */
const LEASE_MS = 4 * 60_000;

/**
 * Drive the clock poller.
 *
 * Two accepted callers, and nothing else:
 *
 *  - A scheduler, presenting `Authorization: Bearer <CRON_SECRET>`. This is
 *    the normal path: the in-process timer calls it over loopback, and an
 *    external cron can drive the identical route on a host where that timer
 *    cannot be relied on.
 *  - A signed-in administrator, asking "why did nobody get told" and wanting
 *    an answer now.
 *
 * With no CRON_SECRET configured the bearer path is disabled entirely rather
 * than falling open.
 */
async function authorize(request: NextRequest): Promise<"system" | "admin"> {
  const configuredSecret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");

  if (configuredSecret && header?.startsWith("Bearer ")) {
    const presented = Buffer.from(header.slice("Bearer ".length));
    const expected = Buffer.from(configuredSecret);

    if (
      presented.length === expected.length &&
      timingSafeEqual(presented, expected)
    ) {
      return "system";
    }
  }

  const actor = await getActorContext();
  if (actor && can(actor, "settings.manage")) return "admin";

  throw forbidden("This endpoint requires the maintenance secret or an administrator.");
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const caller = await authorize(request);

    /*
     * Scheduled runs take a lease; a person pressing a button does not.
     *
     * With two instances both timers fire, both see the same clock-in, and
     * everybody is told twice — so the scheduled path has to be serialised. An
     * administrator asking for a run now has asked explicitly, and answering
     * "somebody else holds the lease" would be a confusing way to say nothing
     * happened.
     */
    if (caller === "system" && !(await acquireLease(LEASE, LEASE_MS))) {
      return jsonOk({ skipped: "another-instance-holds-the-lease" });
    }

    return jsonOk(await runClockWatch());
  });
}
