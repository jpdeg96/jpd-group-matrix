/**
 * Push subscriptions.
 *
 * The rules worth pinning down are about lifecycle, not delivery: a device
 * replacing its own subscription rather than accumulating, a dead endpoint
 * being removed rather than retried forever, and one person being unable to
 * silence another's phone by learning their endpoint.
 *
 * DESTRUCTIVE: truncates users and push subscriptions. Runs against
 * TEST_DATABASE_URL.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

/** Endpoints the fake push service should reject, and with what. */
const rejectWith = new Map<string, number>();
const delivered: string[] = [];

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => undefined,
    sendNotification: async (subscription: { endpoint: string }) => {
      const status = rejectWith.get(subscription.endpoint);
      if (status) {
        const error = new Error(`push failed: ${status}`) as Error & { statusCode: number };
        error.statusCode = status;
        throw error;
      }
      delivered.push(subscription.endpoint);
      return { statusCode: 201 };
    },
  },
}));

process.env.VAPID_PUBLIC_KEY = "test-public";
process.env.VAPID_PRIVATE_KEY = "test-private";
process.env.VAPID_SUBJECT = "mailto:test@example.com";

const { removeSubscription, saveSubscription, sendPush, subscriptionCount } =
  await import("@/lib/services/push");

suite("push subscriptions", () => {
  let danaId: string;
  let marcoId: string;

  const payload = { title: "Test", body: "Body", url: "/dashboard" };

  beforeEach(async () => {
    rejectWith.clear();
    delivered.length = 0;

    await prisma.pushSubscription.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany();

    const role = await prisma.role.findUniqueOrThrow({ where: { key: "USER" } });

    const dana = await prisma.user.create({
      data: {
        email: "dana@test.local",
        displayName: "Dana",
        role: "USER",
        roleId: role.id,
        color: "#059669",
      },
    });
    danaId = dana.id;

    const marco = await prisma.user.create({
      data: {
        email: "marco@test.local",
        displayName: "Marco",
        role: "USER",
        roleId: role.id,
        color: "#ca8a04",
      },
    });
    marcoId = marco.id;
  });

  const subscribe = (userId: string, endpoint: string) =>
    saveSubscription(userId, { endpoint, p256dh: "key", auth: "auth" });

  it("keeps one row per device, not one per subscribe", async () => {
    await subscribe(danaId, "https://push.example/aaa");
    await subscribe(danaId, "https://push.example/aaa");

    expect(await subscriptionCount(danaId)).toBe(1);
  });

  it("reaches every device somebody has", async () => {
    await subscribe(danaId, "https://push.example/phone");
    await subscribe(danaId, "https://push.example/laptop");

    const result = await sendPush([danaId], payload);

    expect(result.sent).toBe(2);
    expect(delivered.sort()).toEqual([
      "https://push.example/laptop",
      "https://push.example/phone",
    ]);
  });

  it("sends nothing to somebody with no devices", async () => {
    const result = await sendPush([danaId], payload);
    expect(result).toEqual({ sent: 0, failed: 0, pruned: 0 });
  });

  it("deletes a subscription the push service says is gone", async () => {
    // 410 means the browser was reinstalled or permission revoked. Retrying it
    // forever is how a table fills with endpoints that can never work again.
    await subscribe(danaId, "https://push.example/dead");
    rejectWith.set("https://push.example/dead", 410);

    const result = await sendPush([danaId], payload);

    expect(result.pruned).toBe(1);
    expect(await subscriptionCount(danaId)).toBe(0);
  });

  it("keeps a device that failed once, and retires one that keeps failing", async () => {
    await subscribe(danaId, "https://push.example/flaky");
    rejectWith.set("https://push.example/flaky", 500);

    await sendPush([danaId], payload);
    expect(await subscriptionCount(danaId)).toBe(1);

    // Five consecutive failures is a device that is not coming back.
    for (let i = 0; i < 4; i += 1) await sendPush([danaId], payload);
    expect(await subscriptionCount(danaId)).toBe(0);
  });

  it("forgets the failures once a device answers again", async () => {
    await subscribe(danaId, "https://push.example/flaky");
    rejectWith.set("https://push.example/flaky", 500);
    await sendPush([danaId], payload);
    await sendPush([danaId], payload);

    rejectWith.clear();
    await sendPush([danaId], payload);

    const row = await prisma.pushSubscription.findFirstOrThrow({
      where: { userId: danaId },
    });
    expect(row.failureCount).toBe(0);
    expect(row.lastSuccessAt).not.toBeNull();
  });

  it("will not let one person unsubscribe another's device", async () => {
    // An endpoint is opaque but it is not a secret.
    await subscribe(danaId, "https://push.example/danas-phone");

    const removed = await removeSubscription(marcoId, "https://push.example/danas-phone");

    expect(removed).toBe(0);
    expect(await subscriptionCount(danaId)).toBe(1);
  });

  it("moves a shared device to whoever signed in last", async () => {
    await subscribe(danaId, "https://push.example/shared");
    await subscribe(marcoId, "https://push.example/shared");

    expect(await subscriptionCount(danaId)).toBe(0);
    expect(await subscriptionCount(marcoId)).toBe(1);
  });
});

/**
 * Muting, end to end.
 *
 * The unit tests cover the rule; these cover that the rule is actually
 * consulted on the path a real notification takes — which is the half that can
 * silently stop working without any of them failing.
 */
suite("muted categories", () => {
  let danaId: string;
  let morganId: string;
  let eventId: string;

  beforeEach(async () => {
    rejectWith.clear();
    delivered.length = 0;

    await prisma.notification.deleteMany();
    await prisma.pushSubscription.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.eventNote.deleteMany();
    await prisma.reviewStage.deleteMany();
    await prisma.event.deleteMany();
    await prisma.eventType.deleteMany();
    await prisma.user.deleteMany();

    const role = await prisma.role.findUniqueOrThrow({ where: { key: "USER" } });

    const dana = await prisma.user.create({
      data: { email: "dana@test.local", displayName: "Dana", role: "USER", roleId: role.id, color: "#059669" },
    });
    danaId = dana.id;

    const morgan = await prisma.user.create({
      data: { email: "morgan@test.local", displayName: "Morgan", role: "USER", roleId: role.id, color: "#2563eb" },
    });
    morganId = morgan.id;

    const type = await prisma.eventType.create({ data: { name: "NFL", sortOrder: 1 } });
    const event = await prisma.event.create({
      data: {
        eventDate: new Date("2026-11-15T00:00:00Z"),
        eventTypeId: type.id,
        awayTeam: "Patriots",
        homeTeam: "Lions",
        status: "DASHBOARD",
      },
    });
    eventId = event.id;

    await prisma.pushSubscription.create({
      data: { userId: danaId, endpoint: "https://push.example/dana", p256dh: "k", auth: "a" },
    });
  });

  const record = async (kind: "MENTIONED" | "FLAG_RAISED" | "FLAG_FIXED") => {
    const row = await prisma.notification.create({
      data: { recipientId: danaId, actorId: morganId, kind, eventId, detail: "note" },
      select: { id: true },
    });
    return row.id;
  };

  it("pushes a category that has not been muted", async () => {
    const { pushNotifications } = await import("@/lib/services/notifications");
    await pushNotifications([await record("MENTIONED")]);

    expect(delivered).toEqual(["https://push.example/dana"]);
  });

  it("does not push a muted category", async () => {
    await prisma.user.update({ where: { id: danaId }, data: { pushMuted: ["MENTIONS"] } });

    const { pushNotifications } = await import("@/lib/services/notifications");
    await pushNotifications([await record("MENTIONED")]);

    expect(delivered).toEqual([]);
  });

  it("still pushes the categories that were left on", async () => {
    await prisma.user.update({ where: { id: danaId }, data: { pushMuted: ["MENTIONS"] } });

    const { pushNotifications } = await import("@/lib/services/notifications");
    await pushNotifications([await record("FLAG_RAISED")]);

    expect(delivered).toEqual(["https://push.example/dana"]);
  });

  it("silences a muted flag resolution, which shares a switch with fixing", async () => {
    await prisma.user.update({ where: { id: danaId }, data: { pushMuted: ["FLAGS_RESOLVED"] } });

    const { pushNotifications } = await import("@/lib/services/notifications");
    await pushNotifications([await record("FLAG_FIXED")]);

    expect(delivered).toEqual([]);
  });

  it("keeps the bell entry for a muted category", async () => {
    // Muting is about the phone. Hiding the notification itself would lose the
    // record of something somebody still needs to deal with.
    await prisma.user.update({ where: { id: danaId }, data: { pushMuted: ["MENTIONS"] } });

    const id = await record("MENTIONED");
    const { pushNotifications } = await import("@/lib/services/notifications");
    await pushNotifications([id]);

    expect(await prisma.notification.findUnique({ where: { id } })).not.toBeNull();
  });
});
