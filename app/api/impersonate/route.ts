import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { IMPERSONATION_COOKIE, requireRealAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { notFound, validationError } from "@/lib/errors";
import { recordAudit } from "@/lib/services/audit";
import { impersonateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start or stop "view as another user".
 *
 * The cookie set here is not itself a credential — it is only honoured when the
 * real session belongs to an active administrator, which `getActorContext`
 * re-checks on every single request. Forging it achieves nothing.
 *
 * Authorisation uses the *real* account rather than the effective one, so an
 * administrator already viewing as a regular user can still switch back.
 *
 * Every start and stop is audited, and every action taken while impersonating
 * records both the administrator and the account they were acting as.
 */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireRealAdmin();
    const { userId } = impersonateSchema.parse(await readJson(request));
    const store = await cookies();

    if (userId === null) {
      store.delete(IMPERSONATION_COOKIE);

      if (actor.isImpersonating) {
        await recordAudit({
          userId: actor.real.id,
          impersonatedUserId: actor.effective.id,
          entityType: "IMPERSONATION",
          entityId: actor.effective.id,
          action: "STOPPED",
        });
      }

      return jsonOk({ impersonating: null });
    }

    if (userId === actor.real.id) {
      throw validationError("You are already signed in as yourself.");
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, role: true, active: true },
    });

    if (!target) throw notFound("That user no longer exists.");
    if (!target.active) {
      throw validationError("You cannot view as a deactivated user.");
    }

    store.set(IMPERSONATION_COOKIE, target.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // Deliberately short: impersonation should be a brief, intentional act,
      // not a state somebody forgets they are in.
      maxAge: 60 * 60,
    });

    await recordAudit({
      userId: actor.real.id,
      impersonatedUserId: target.id,
      entityType: "IMPERSONATION",
      entityId: target.id,
      action: "STARTED",
      newValue: { displayName: target.displayName, role: target.role },
    });

    return jsonOk({
      impersonating: { id: target.id, displayName: target.displayName },
    });
  });
}
