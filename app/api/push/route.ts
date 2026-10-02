import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import {
  isPushConfigured,
  pushPublicKey,
  removeSubscription,
  saveSubscription,
  subscriptionCount,
} from "@/lib/services/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A browser's push subscription, as the Push API produces it.
 *
 * The endpoint is checked for being a URL but deliberately not for its host:
 * which push service a browser uses is the browser's business, and an
 * allow-list here would break the moment a vendor moved a hostname.
 */
const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
});

/**
 * What this browser needs to subscribe, and whether it is worth offering.
 *
 * The public key is public by definition — every subscribing browser is handed
 * it, and it is useless without the private half — so serving it to any
 * signed-in user costs nothing.
 */
export async function GET() {
  return handle(async () => {
    const actor = await requireUser();

    return jsonOk({
      enabled: isPushConfigured(),
      publicKey: pushPublicKey(),
      devices: await subscriptionCount(actor.effective.id),
    });
  });
}

/** Register this browser. */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireUser();
    const input = subscribeSchema.parse(await readJson(request));

    await saveSubscription(actor.effective.id, {
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      // Only to make a stale device recognisable in a list; never parsed.
      userAgent: request.headers.get("user-agent")?.slice(0, 255) ?? null,
    });

    return jsonOk({ devices: await subscriptionCount(actor.effective.id) });
  });
}

/**
 * Forget this browser.
 *
 * Scoped to the caller, so knowing somebody else's endpoint is not enough to
 * silence their phone.
 */
export async function DELETE(request: NextRequest) {
  return handle(async () => {
    const actor = await requireUser();
    const input = unsubscribeSchema.parse(await readJson(request));

    const removed = await removeSubscription(actor.effective.id, input.endpoint);

    return jsonOk({
      removed,
      devices: await subscriptionCount(actor.effective.id),
    });
  });
}
