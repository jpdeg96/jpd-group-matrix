/**
 * Web push.
 *
 * Sends a notification to a person's devices rather than to a person: one
 * subscription per browser, and somebody with a phone and a laptop has two.
 *
 * Everything here is best-effort and never throws into a caller. A push is a
 * courtesy copy of something already recorded — the bell, the audit log, the
 * row itself — so a push service having a bad minute must not roll back the
 * flag that was raised or the clock-in that happened. Failures are counted,
 * and a subscription the push service says is gone is deleted.
 */

import { prisma } from "@/lib/db/prisma";

/** Shape of the subscription `web-push` expects, without importing it. */
interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Failures before a subscription is retired.
 *
 * Only for the soft errors. A push service answering 404 or 410 is telling us
 * the subscription no longer exists and that row goes immediately; this covers
 * timeouts and 5xx, where the device may simply be unreachable. Five
 * consecutive misses is a device that is not coming back, not a bad night.
 */
const MAX_FAILURES = 5;

/** What a push carries. Kept small — some services cap the payload near 4KB. */
export interface PushPayload {
  title: string;
  body: string;
  /** Opened when the notification is tapped. Relative to the site root. */
  url: string;
  /**
   * Collapses with any unread notification sharing this tag, so twelve flags
   * raised during a meeting are one line on the lock screen rather than twelve.
   */
  tag?: string;
  /** Distinguishes a clock event from a flag in the service worker. */
  kind?: string;
}

/**
 * Whether push is configured at all.
 *
 * With no keys the whole feature is off rather than broken: nothing is
 * offered, nothing is stored, and nothing is sent. Every other notification
 * path is untouched, so an unconfigured environment behaves exactly as it did
 * before push existed.
 */
export function isPushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

export function pushPublicKey(): string | null {
  return isPushConfigured() ? (process.env.VAPID_PUBLIC_KEY ?? null) : null;
}

/**
 * The `web-push` module, loaded on first use rather than imported.
 *
 * It reaches Node's `http` and `https` through https-proxy-agent. This module
 * is reachable from `instrumentation.ts`, which Next compiles for every
 * runtime including ones that have no such modules — and a static import makes
 * that a build-time resolution failure which 500s every route in the
 * application, not just this feature. Behind an await it is never traced into
 * that graph, and it is only ever loaded on a server that is about to send.
 *
 * Cached across calls: setting the VAPID details is global to the module, and
 * re-importing per push would redo it on every notification.
 */
let webpushPromise: Promise<typeof import("web-push")> | null = null;

async function loadWebPush(): Promise<typeof import("web-push") | null> {
  if (!isPushConfigured()) return null;

  if (!webpushPromise) {
    webpushPromise = import("web-push").then((module) => {
      const lib = module.default ?? module;
      lib.setVapidDetails(
        process.env.VAPID_SUBJECT!,
        process.env.VAPID_PUBLIC_KEY!,
        process.env.VAPID_PRIVATE_KEY!,
      );
      return lib as typeof import("web-push");
    });
  }

  return webpushPromise;
}

/**
 * Send to everybody in `userIds`, on every device each of them has.
 *
 * Returns how many individual devices accepted it, which is the only number
 * that means anything: three recipients with two phones each is six.
 */
export async function sendPush(
  userIds: readonly string[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number; pruned: number }> {
  const empty = { sent: 0, failed: 0, pruned: 0 };

  const webpush = await loadWebPush();
  if (!webpush) return empty;

  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) return empty;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: { in: recipients } },
  });
  if (subscriptions.length === 0) return empty;

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  let pruned = 0;

  // In parallel: these are independent network calls to several push services,
  // and a slow one must not hold up the rest.
  await Promise.all(
    subscriptions.map(async (row) => {
      const target: WebPushSubscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };

      try {
        await webpush.sendNotification(target, body, { TTL: 60 * 60 * 12 });
        sent += 1;

        // Only written when it had been failing, so a healthy device is not
        // an extra write on every single push.
        if (row.failureCount > 0 || row.lastSuccessAt === null) {
          await prisma.pushSubscription.update({
            where: { id: row.id },
            data: { failureCount: 0, lastSuccessAt: new Date() },
          });
        }
      } catch (error) {
        const status =
          typeof error === "object" && error !== null && "statusCode" in error
            ? Number((error as { statusCode: unknown }).statusCode)
            : 0;

        // 404/410 is the push service saying this subscription is gone —
        // the browser was reinstalled, the site was removed from the home
        // screen, permission was revoked. There is nothing to retry.
        if (status === 404 || status === 410) {
          await prisma.pushSubscription
            .delete({ where: { id: row.id } })
            .catch(() => undefined);
          pruned += 1;
          return;
        }

        failed += 1;
        const next = row.failureCount + 1;

        if (next >= MAX_FAILURES) {
          await prisma.pushSubscription
            .delete({ where: { id: row.id } })
            .catch(() => undefined);
          pruned += 1;
        } else {
          await prisma.pushSubscription
            .update({ where: { id: row.id }, data: { failureCount: next } })
            .catch(() => undefined);
        }
      }
    }),
  );

  return { sent, failed, pruned };
}

/**
 * Record a browser's permission to notify this person.
 *
 * Keyed on the endpoint, so re-subscribing on a device that already had one
 * replaces it rather than accumulating. The endpoint can also move between
 * accounts — a shared machine where somebody signs out and a colleague signs
 * in — so the owner is rewritten too.
 */
export async function saveSubscription(
  userId: string,
  input: { endpoint: string; p256dh: string; auth: string; userAgent?: string | null },
): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
    },
    update: {
      userId,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
      failureCount: 0,
    },
  });
}

/**
 * Forget a subscription.
 *
 * Scoped to the caller: an endpoint is a long opaque string, but it is not a
 * secret, and deleting by endpoint alone would let anybody who learned one
 * silence somebody else's phone.
 */
export async function removeSubscription(
  userId: string,
  endpoint: string,
): Promise<number> {
  const result = await prisma.pushSubscription.deleteMany({
    where: { userId, endpoint },
  });
  return result.count;
}

/** How many devices this person would be reached on. */
export async function subscriptionCount(userId: string): Promise<number> {
  if (!isPushConfigured()) return 0;
  return prisma.pushSubscription.count({ where: { userId } });
}
