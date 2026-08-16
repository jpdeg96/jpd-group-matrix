import { handle, jsonOk } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/guards";
import { validationError } from "@/lib/errors";
import { isDiscordConfigured, notify } from "@/lib/notify/discord";
import { testMessage } from "@/lib/notify/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Posts one test notification.
 *
 * Deliberately ignores the Discord *enabled* switch: this is how you check the
 * webhook works before turning it on, and refusing until it is already on would
 * make the switch a leap of faith.
 *
 * `notify` swallows its own failures, which is right for background use and
 * wrong here — a test that always says "sent" tests nothing. So the result is
 * unwrapped and a failure becomes a real error the administrator can read.
 */
export async function POST() {
  return handle(async () => {
    const actor = await requireAdmin();

    if (!isDiscordConfigured()) {
      throw validationError(
        "DISCORD_WEBHOOK_URL is not set on the server. Add it, restart, then try again.",
      );
    }

    const result = await notify(testMessage(actor.effective.displayName));
    if (!result.delivered) {
      throw validationError(result.error ?? "Discord did not accept the message.");
    }

    return jsonOk({ delivered: true });
  });
}
