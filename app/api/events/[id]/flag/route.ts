import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import { flagEvent, resolveFlag } from "@/lib/services/events";
import { flagEventSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Raise a flag for manager review.
 *
 * Open to every role on purpose: the person who notices a problem is usually
 * not the person permitted to fix it, and a flag they cannot raise is a problem
 * that stays unreported.
 */
export async function POST(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await params;
    const { reason } = flagEventSchema.parse(await readJson(request));
    return jsonOk({ event: await flagEvent(id, reason ?? null, actor) });
  });
}

/** Clear a flag. Manager or administrator only — enforced in the service. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await params;
    return jsonOk({ event: await resolveFlag(id, actor) });
  });
}
