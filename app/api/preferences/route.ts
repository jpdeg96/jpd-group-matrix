import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { updatePreferencesSchema } from "@/lib/validation/schemas";
import { cleanMuted } from "@/lib/domain/push-categories";

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
    const input = updatePreferencesSchema.parse(await readJson(request));

    // The *effective* user: an administrator viewing as someone else is
    // changing that person's screen, which is what makes it a faithful preview.
    const updated = await prisma.user.update({
      where: { id: actor.effective.id },
      data: {
        // Each field only when sent, so a client saving one preference does
        // not silently reset the other to its default.
        ...(input.theme !== undefined ? { theme: input.theme } : {}),
        ...(input.pushMuted !== undefined
          ? {
              // Unknown keys dropped: a stale category name from an old client
              // must not silently mute something, and must not be stored to
              // confuse the next reader.
              pushMuted: cleanMuted(input.pushMuted),
              // Kept in step for one release so a rollback to the code that
              // read this boolean still finds the right answer. Nothing reads
              // it now.
              pushClockEvents: !cleanMuted(input.pushMuted).includes("CLOCK"),
            }
          : {}),
      },
      select: { theme: true, pushMuted: true },
    });

    return jsonOk(updated);
  });
}
