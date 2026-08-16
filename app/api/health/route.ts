import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness probe for an external uptime monitor.
 *
 * ## Why this exists rather than a Discord alert for "site is offline"
 *
 * A site that is down cannot report that it is down. Outage detection has to
 * come from outside the thing being watched, so this endpoint is the target for
 * a third-party monitor, and the monitor is what posts to Discord when it stops
 * answering. Everything the application *can* honestly report about itself —
 * releases, payroll, Clockify — it posts directly.
 *
 * ## Deliberately unauthenticated, and deliberately dull
 *
 * A monitor cannot log in, so this is public, which means it must give away
 * nothing: no version, no counts, no configuration, no error text. A caller
 * learns exactly one thing, which is the one thing they would learn anyway by
 * loading the site.
 *
 * The database round-trip is the point. A process that is running but cannot
 * reach Postgres serves nothing useful, and a health check that only proves
 * Node is alive would call that healthy.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    // The reason is logged for whoever is on the inside; the response says only
    // that it failed, because this is readable by anyone.
    console.error("[health] database unreachable");
    return Response.json(
      { status: "unhealthy" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { status: "ok" },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
