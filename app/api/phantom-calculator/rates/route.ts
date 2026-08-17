import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { handle, jsonOk } from "@/lib/api/respond";
import { getSessionUser } from "@/lib/auth/guards";
import { forbidden, notFound } from "@/lib/errors";
import { getSettings } from "@/lib/services/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The rates the Phantom Calculator desktop application runs on.
 *
 * ## Read-only, and only these two numbers
 *
 * The desktop calculator needs the Tier 1 and StubHub rates and nothing else,
 * so that is all this returns. There is deliberately no PATCH here: rates are
 * changed by an administrator in Matrix Settings, through the existing
 * `/api/settings` route with its existing role gate. An installed copy of the
 * calculator on somebody's laptop must never be able to move a rate that
 * changes what everyone else pays for tickets.
 *
 * ## Authentication
 *
 * Two accepted callers, mirroring the maintenance endpoint:
 *
 *  - The desktop application, presenting `Authorization: Bearer
 *    <PHANTOM_RATES_TOKEN>`. The token is entered once per machine into
 *    `settings.json` beside the calculator's cache — never compiled into the
 *    executable, which would put a shared credential in every copy handed out
 *    and make rotating it a redistribution.
 *  - A signed-in Matrix user, so an administrator can check the endpoint in a
 *    browser tab and see exactly what the calculator sees.
 *
 * With no `PHANTOM_RATES_TOKEN` configured the endpoint is open, on the same
 * reasoning as `/api/health`: it is read-only and carries two markup rates, no
 * credential, no identity and no business record. That is a deliberate choice
 * rather than an oversight — set the variable and the door closes. It is the
 * opposite of the maintenance endpoint's rule, and for the opposite reason:
 * that one *drives* promotion and archival, so falling open there would hand a
 * stranger the workflow.
 *
 * ## An unset rate is not zero
 *
 * If either rate is missing this answers 404 rather than substituting a
 * default. The calculator turns that into "Unable to load Phantom Calculator
 * rates" and refuses to produce a purchase price. A fabricated rate here would
 * become a real overpayment on a real ticket.
 */
async function authorize(request: NextRequest): Promise<void> {
  const configuredToken = process.env.PHANTOM_RATES_TOKEN;
  if (!configuredToken) return;

  const header = request.headers.get("authorization");

  if (header?.startsWith("Bearer ")) {
    const presented = Buffer.from(header.slice("Bearer ".length));
    const expected = Buffer.from(configuredToken);

    // Length is compared first because timingSafeEqual throws on a mismatch,
    // and the comparison itself is constant-time so a wrong token leaks
    // nothing about the right one.
    if (presented.length === expected.length && timingSafeEqual(presented, expected)) {
      return;
    }
  }

  const user = await getSessionUser();
  if (user) return;

  throw forbidden("This endpoint requires the Phantom Calculator token or a signed-in user.");
}

export async function GET(request: NextRequest) {
  return handle(async () => {
    await authorize(request);

    const settings = await getSettings();
    const { phantomTier1Rate: tier1, phantomStubHubRate: stubhub } = settings;

    if (tier1 === null || stubhub === null) {
      throw notFound(
        "Phantom Calculator rates have not been set. An administrator sets them in Matrix Settings.",
      );
    }

    // no-store because the calculator caches this itself, on disk, and a proxy
    // holding a stale rate would be invisible to both ends.
    return jsonOk({ tier1, stubhub }, { headers: { "Cache-Control": "no-store" } });
  });
}
