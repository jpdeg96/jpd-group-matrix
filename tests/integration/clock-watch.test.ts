/**
 * The clock watcher.
 *
 * The cases that matter are the ones where doing the obvious thing is wrong:
 * the first poll after a restart must announce nothing, an unreachable Clockify
 * must not read as everybody clocking out, and somebody stopping and starting
 * between two polls must not pass unnoticed just because `running` is true at
 * both ends.
 *
 * DESTRUCTIVE: truncates users and clock status. Runs against TEST_DATABASE_URL.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_GRANTS } from "@/lib/domain/permissions";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

// The Clockify client is the only thing reaching the network; everything else
// under test is real, including the database writes the diff depends on.
const running = new Map<string, { start: string } | null>();
const failing = new Set<string>();

vi.mock("@/lib/clockify/client", () => ({
  isClockifyConfigured: () => true,
  getRunningEntry: async (_workspaceId: string, clockifyUserId: string) => {
    if (failing.has(clockifyUserId)) throw new Error("clockify unreachable");
    const entry = running.get(clockifyUserId);
    return entry ? { timeInterval: { start: entry.start, end: null } } : null;
  },
}));

vi.mock("@/lib/services/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/settings")>()),
  getSettings: async () => ({
    clockifyEnabled: true,
    clockifyWorkspaceId: "ws_test",
    timeZone: "America/Caracas",
  }),
}));

const { pollClockStatus } = await import("@/lib/services/clock-watch");

suite("clock watcher", () => {
  let danaId: string;
  let managerId: string;

  beforeEach(async () => {
    running.clear();
    failing.clear();

    await prisma.clockStatus.deleteMany();
    await prisma.pushSubscription.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany();

    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: "MANAGER" } });
    const userRole = await prisma.role.findUniqueOrThrow({ where: { key: "USER" } });

    // Restore the built-in grants in case another suite changed them.
    await prisma.rolePermission.deleteMany({ where: { roleId: managerRole.id } });
    await prisma.rolePermission.createMany({
      data: DEFAULT_GRANTS.MANAGER.map((permission) => ({
        roleId: managerRole.id,
        permission,
      })),
    });

    const dana = await prisma.user.create({
      data: {
        email: "dana@test.local",
        displayName: "Dana",
        role: "USER",
        roleId: userRole.id,
        color: "#059669",
        clockifyUserId: "ck_dana",
      },
    });
    danaId = dana.id;

    const manager = await prisma.user.create({
      data: {
        email: "manager@test.local",
        displayName: "Morgan",
        role: "MANAGER",
        roleId: managerRole.id,
        color: "#2563eb",
      },
    });
    managerId = manager.id;
  });

  it("says nothing on the first poll, however many people are on the clock", async () => {
    // Otherwise a restart at 10am announces the whole team as just arriving.
    running.set("ck_dana", { start: "2026-10-01T12:00:00Z" });

    const result = await pollClockStatus();

    expect(result.checked).toBe(1);
    expect(result.transitions).toEqual([]);

    const stored = await prisma.clockStatus.findUniqueOrThrow({ where: { userId: danaId } });
    expect(stored.running).toBe(true);
  });

  it("reports a clock-in once the previous state is known", async () => {
    await pollClockStatus(); // Records "not running".

    running.set("ck_dana", { start: "2026-10-01T12:00:00Z" });
    const result = await pollClockStatus();

    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({ userId: danaId, kind: "IN" });
  });

  it("reports a clock-out", async () => {
    running.set("ck_dana", { start: "2026-10-01T12:00:00Z" });
    await pollClockStatus();

    running.set("ck_dana", null);
    const result = await pollClockStatus();

    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({ userId: danaId, kind: "OUT" });
  });

  it("says nothing while somebody stays on the same timer", async () => {
    running.set("ck_dana", { start: "2026-10-01T12:00:00Z" });
    await pollClockStatus();

    const result = await pollClockStatus();
    expect(result.transitions).toEqual([]);
  });

  it("catches a stop and restart between two polls", async () => {
    // `running` is true at both ends, so comparing the flag alone sees nothing
    // — the start time is what gives it away.
    running.set("ck_dana", { start: "2026-10-01T12:00:00Z" });
    await pollClockStatus();

    running.set("ck_dana", { start: "2026-10-01T12:40:00Z" });
    const result = await pollClockStatus();

    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({ kind: "IN" });
  });

  it("leaves stored state alone when Clockify cannot be reached", async () => {
    // Recording "not running" on a failed request would fire a clock-out that
    // never happened, then a clock-in when the API came back.
    running.set("ck_dana", { start: "2026-10-01T12:00:00Z" });
    await pollClockStatus();

    failing.add("ck_dana");
    const result = await pollClockStatus();

    expect(result.checked).toBe(0);
    expect(result.transitions).toEqual([]);

    const stored = await prisma.clockStatus.findUniqueOrThrow({ where: { userId: danaId } });
    expect(stored.running).toBe(true);
  });

  it("ignores people who are not linked to Clockify", async () => {
    // The manager has no clockifyUserId, so there is nothing to ask about.
    running.set("ck_dana", { start: "2026-10-01T12:00:00Z" });
    const result = await pollClockStatus();

    expect(result.checked).toBe(1);
    expect(
      await prisma.clockStatus.findUnique({ where: { userId: managerId } }),
    ).toBeNull();
  });

  it("does not poll somebody who has been deactivated", async () => {
    await prisma.user.update({ where: { id: danaId }, data: { active: false } });
    running.set("ck_dana", { start: "2026-10-01T12:00:00Z" });

    const result = await pollClockStatus();
    expect(result.checked).toBe(0);
  });
});
