import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { updatePreferencesSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A person's own preferences.
 *
 * Deliberately separate from `/api/users/[id]`, which is administrator-only:
 * everyone may set their own theme, and nobody may set anyone else's. The id is
 * taken from the session rather than the request body, so there is no target to
 * tamper with.
 *
 * Stored on the user row rather than only in localStorage so the choice follows
 * them between machines. `null` means "follow the site default".
 */
export async function PATCH(request: NextRequest) {
  return handle(async () => {
    const actor = await requireUser();
    const { theme } = updatePreferencesSchema.parse(await readJson(request));

    // The *effective* user: an administrator viewing as someone else is
    // changing that person's screen, which is what makes it a faithful preview.
    await prisma.user.update({
      where: { id: actor.effective.id },
      data: { theme },
    });

    return jsonOk({ theme });
  });
}
