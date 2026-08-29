/**
 * Database-backed workflow tests.
 *
 * These need a real PostgreSQL database — transactional promotion, the CHECK
 * constraints and targeted column updates cannot be proven against a mock.
 *
 *   npm run db:deploy
 *   npm run test:integration
 *
 * DESTRUCTIVE: truncates every table. Runs against TEST_DATABASE_URL when set.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { addDays, dbDateFromPlainDate, plainDateFromDbDate, toPlainDate, type PlainDate } from "@/lib/date/plain-date";
import { businessToday, invalidateSettingsCache } from "@/lib/services/settings";
import { getMetrics } from "@/lib/services/metrics";
import {
  createEvent,
  deleteEvent,
  flagEvent,
  getCompletionHistory,
  getDashboardStats,
  listDashboardEvents,
  markFlagFixed,
  resolveFlag,
  updateEvent,
  sendToC1,
} from "@/lib/services/events";
import {
  bulkUpdateReviewDue,
  listC1Rows,
  listCompletedStages,
  updateStage,
} from "@/lib/services/stages";
import { addNote, listNotes } from "@/lib/services/notes";
import { applyBulkUpdate, planBulkUpdate } from "@/lib/services/bulk-events";
import { listNotifications, markRead } from "@/lib/services/notifications";
import {
  listPresence,
  listTeamPresence,
  startPresence,
  stopPresence,
} from "@/lib/services/presence";
import { archivePastEvents } from "@/lib/services/maintenance";
import type { ActorContext } from "@/lib/auth/actor";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  console.warn("\n[integration] DATABASE_URL is not set — skipping.\n");
}

suite("event workflow", () => {
  let admin: ActorContext;
  let manager: ActorContext;
  let worker: ActorContext;
  let typeId: string;
  let today: PlainDate;

  const actorFor = (user: {
    id: string;
    email: string;
    displayName: string;
    role: "ADMIN" | "MANAGER" | "USER";
    color: string;
    theme: string | null;
  }): ActorContext => ({ effective: user, real: user, isImpersonating: false });

  beforeEach(async () => {
    invalidateSettingsCache();

    await prisma.auditLog.deleteMany();
    await prisma.presence.deleteMany();
    await prisma.eventNote.deleteMany();
    await prisma.reviewStage.deleteMany();
    await prisma.event.deleteMany();
    await prisma.eventType.deleteMany();
    await prisma.user.deleteMany();

    const [a, m, w] = await Promise.all([
      prisma.user.create({
        data: { email: "admin@test.local", displayName: "Admin", role: "ADMIN", color: "#2563eb" },
      }),
      prisma.user.create({
        data: { email: "mgr@test.local", displayName: "Manager", role: "MANAGER", color: "#059669" },
      }),
      prisma.user.create({
        data: { email: "user@test.local", displayName: "Worker", role: "USER", color: "#ca8a04" },
      }),
    ]);

    admin = actorFor(a);
    manager = actorFor(m);
    worker = actorFor(w);

    const type = await prisma.eventType.create({ data: { name: "NFL" } });
    typeId = type.id;

    today = await businessToday();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const makeEvent = (daysOut: number) =>
    createEvent(
      { eventDate: addDays(today, daysOut), eventTypeId: typeId, awayTeam: "A", homeTeam: "B", venue: "V" },
      admin,
    );

  const stagesFor = (eventId: string) =>
    prisma.reviewStage.findMany({ where: { eventId }, orderBy: { offsetDays: "desc" } });

  /* ---------------------------------------------------------------------- */

  /**
 * Complete an event and send it to C1.
 *
 * Ticking Complete no longer promotes on its own, so tests whose subject is
 * what happens *in* C1 use this to get there in one line. Tests about the
 * split itself call the two steps separately, on purpose.
 */
async function completeAndSend(eventId: string, actor: typeof manager) {
  await updateEvent(eventId, { complete: true }, actor);
  return sendToC1(eventId, actor);
}

describe("promotion into C1", () => {
    it("stays on the dashboard until Complete is ticked", async () => {
      const event = await makeEvent(30);
      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });

      expect(stored.status).toBe("DASHBOARD");
      expect(await stagesFor(event.id)).toHaveLength(0);
    });

    it("ticking Complete records the completion but does not promote", async () => {
      // The split. Finishing the dashboard work and deciding the event is ready
      // for review are two judgements, so a mis-click on the checkbox no longer
      // builds five review stages and moves the row to another screen.
      const event = await makeEvent(30);
      await updateEvent(event.id, { complete: true }, manager);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.status).toBe("DASHBOARD");
      expect(stored.completedAt).not.toBeNull();
      expect(stored.completedById).toBe(manager.effective.id);
      expect(stored.promotedAt).toBeNull();
      expect(await stagesFor(event.id)).toHaveLength(0);
    });

    it("sending to C1 promotes it and generates every stage", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { complete: true }, manager);

      const result = await sendToC1(event.id, manager);
      expect(result.stagesCreated).toBe(5);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.status).toBe("C1");
      expect(stored.promotedAt).not.toBeNull();

      const stages = await stagesFor(event.id);
      expect(stages.map((s) => s.offsetDays)).toEqual([21, 14, 7, 5, 1]);
      expect(stages.every((s) => s.status === "PENDING")).toBe(true);
    });

    it("refuses to send an event that has not been completed", async () => {
      const event = await makeEvent(30);

      await expect(sendToC1(event.id, manager)).rejects.toThrow(/Tick Complete first/);
      expect(await stagesFor(event.id)).toHaveLength(0);
    });

    it("refuses to send the same event twice", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);

      await expect(sendToC1(event.id, manager)).rejects.toThrow(/already in C1/);
      expect(await stagesFor(event.id)).toHaveLength(5);
    });

    it("marks stages already past at promotion as SKIPPED, not PENDING", async () => {
      // Completed 10 days out: D-21 and D-14 were never actionable.
      const event = await makeEvent(10);
      await completeAndSend(event.id, manager);

      const stages = await stagesFor(event.id);
      const skipped = stages.filter((s) => s.status === "SKIPPED").map((s) => s.offsetDays);
      const pending = stages.filter((s) => s.status === "PENDING").map((s) => s.offsetDays);

      expect(skipped).toEqual([21, 14]);
      expect(pending).toEqual([7, 5, 1]);
    });

    it("is idempotent — re-ticking Complete does not duplicate stages", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);
      await updateEvent(event.id, { complete: true }, manager);

      expect(await stagesFor(event.id)).toHaveLength(5);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe("C1 shows one row per event, on its current stage", () => {
    it("starts on the furthest-out stage and advances as each is done", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);

      let rows = await listC1Rows();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.offsetDays).toBe(21);
      expect(rows[0]!.resolvedStages).toBe(0);

      await updateStage(rows[0]!.stageId, { done: true }, worker);

      rows = await listC1Rows();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.offsetDays).toBe(14);
      expect(rows[0]!.resolvedStages).toBe(1);
      // The due date moves with the stage.
      expect(rows[0]!.reviewDue).not.toBe(rows[0]!.eventDate);
    });

    it("leaves C1 once every stage is resolved", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);

      for (let i = 0; i < 5; i += 1) {
        const rows = await listC1Rows();
        expect(rows).toHaveLength(1);
        await updateStage(rows[0]!.stageId, { done: true }, worker);
      }

      expect(await listC1Rows()).toHaveLength(0);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.status).toBe("COMPLETED");
    });

    it("re-opening a stage brings the event back into C1", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);

      let stageId = "";
      for (let i = 0; i < 5; i += 1) {
        const rows = await listC1Rows();
        stageId = rows[0]!.stageId;
        await updateStage(stageId, { done: true }, worker);
      }
      expect(await listC1Rows()).toHaveLength(0);

      await updateStage(stageId, { done: false }, worker);

      const rows = await listC1Rows();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.offsetDays).toBe(1);
    });

    it("records who completed a stage and when", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);
      const rows = await listC1Rows();

      await updateStage(rows[0]!.stageId, { done: true }, worker);

      const stage = await prisma.reviewStage.findUniqueOrThrow({
        where: { id: rows[0]!.stageId },
      });
      expect(stage.status).toBe("DONE");
      expect(stage.doneAt).not.toBeNull();
      expect(stage.doneById).toBe(worker.effective.id);
    });

    it("keeps a manually set review due date flagged as overridden", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);
      const rows = await listC1Rows();

      const manual = addDays(today, 3);
      await updateStage(rows[0]!.stageId, { reviewDue: manual }, admin);

      const stage = await prisma.reviewStage.findUniqueOrThrow({
        where: { id: rows[0]!.stageId },
      });
      expect(plainDateFromDbDate(stage.reviewDue)).toBe(manual);
      expect(stage.reviewDueOverridden).toBe(true);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe("moving an event date warns instead of recalculating", () => {
    async function promoted() {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);
      return event;
    }

    it("leaves every review date exactly where it was", async () => {
      const event = await promoted();
      const before = await stagesFor(event.id);

      await updateEvent(event.id, { eventDate: addDays(today, 45) }, admin);

      const after = await stagesFor(event.id);
      expect(after.map((s) => plainDateFromDbDate(s.reviewDue))).toEqual(
        before.map((s) => plainDateFromDbDate(s.reviewDue)),
      );
    });

    it("flags the event, naming the stages that no longer match", async () => {
      const event = await promoted();
      await updateEvent(event.id, { eventDate: addDays(today, 45) }, admin);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.flaggedAt).not.toBeNull();
      expect(stored.flagReason).toContain("Event date moved");
      expect(stored.flagReason).toContain("D-21");
    });

    it("surfaces the drift on the C1 row with the expected date", async () => {
      const event = await promoted();
      await updateEvent(event.id, { eventDate: addDays(today, 45) }, admin);

      const row = (await listC1Rows()).find((r) => r.eventId === event.id)!;
      expect(row.scheduleDrifted).toBe(true);
      expect(row.expectedReviewDue).not.toBe(row.reviewDue);
    });

    it("does not flag when the date does not actually change", async () => {
      const event = await promoted();
      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      await updateEvent(
        event.id,
        { eventDate: plainDateFromDbDate(stored.eventDate) },
        admin,
      );

      const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(after.flaggedAt).toBeNull();
    });

    it("does not flag an event that has no stages yet", async () => {
      // Still on the dashboard: there is no schedule to drift from.
      const event = await makeEvent(30);
      await updateEvent(event.id, { eventDate: addDays(today, 45) }, admin);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.flaggedAt).toBeNull();
    });

    it("ignores hand-set dates when deciding whether to warn", async () => {
      const event = await promoted();
      const rows = await listC1Rows();
      const row = rows.find((r) => r.eventId === event.id)!;

      // Every pending stage set by hand → nothing is following the formula.
      const stages = await stagesFor(event.id);
      await prisma.reviewStage.updateMany({
        where: { eventId: event.id },
        data: { reviewDueOverridden: true },
      });
      expect(stages.length).toBeGreaterThan(0);
      expect(row).toBeDefined();

      await updateEvent(event.id, { eventDate: addDays(today, 45) }, admin);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.flaggedAt).toBeNull();
    });

    it("lets an administrator adopt the calculated date", async () => {
      const event = await promoted();
      await updateEvent(event.id, { eventDate: addDays(today, 45) }, admin);

      const row = (await listC1Rows()).find((r) => r.eventId === event.id)!;
      await updateStage(row.stageId, { reviewDue: row.expectedReviewDue }, admin);

      const after = (await listC1Rows()).find((r) => r.eventId === event.id)!;
      expect(after.reviewDue).toBe(row.expectedReviewDue);
      expect(after.scheduleDrifted).toBe(false);
      // Adopting it counts as a hand-set date, so it stays exempt afterwards.
      expect(after.reviewDueOverridden).toBe(true);
    });
  });

  describe("review due dates are administrator-only", () => {
    async function c1Row() {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);
      return (await listC1Rows())[0]!;
    }

    it("stops a regular user moving a review date", async () => {
      const row = await c1Row();
      await expect(
        updateStage(row.stageId, { reviewDue: addDays(today, 3) }, worker),
      ).rejects.toThrow(/administrators/i);
    });

    it("stops a manager moving a review date", async () => {
      const row = await c1Row();
      await expect(
        updateStage(row.stageId, { reviewDue: addDays(today, 3) }, manager),
      ).rejects.toThrow(/administrators/i);
    });

    it("lets an administrator move one", async () => {
      const row = await c1Row();
      const target = addDays(today, 3);
      await updateStage(row.stageId, { reviewDue: target }, admin);

      const stage = await prisma.reviewStage.findUniqueOrThrow({
        where: { id: row.stageId },
      });
      expect(plainDateFromDbDate(stage.reviewDue)).toBe(target);
    });

    it("still lets a manager assign and complete the same stage", async () => {
      // The restriction is narrow: only the date is locked down, not the row.
      const row = await c1Row();
      await updateStage(row.stageId, { assigneeId: worker.effective.id }, manager);
      await updateStage(row.stageId, { done: true }, manager);

      const stage = await prisma.reviewStage.findUniqueOrThrow({
        where: { id: row.stageId },
      });
      expect(stage.assigneeId).toBe(worker.effective.id);
      expect(stage.status).toBe("DONE");
    });

    it("refuses a bulk date change from a manager", async () => {
      const row = await c1Row();
      await expect(
        bulkUpdateReviewDue(
          { stageIds: [row.stageId], reviewDue: addDays(today, 5) },
          manager,
        ),
      ).rejects.toThrow(/administrators/i);
    });

    it("allows a bulk date change from an administrator", async () => {
      const row = await c1Row();
      const result = await bulkUpdateReviewDue(
        { stageIds: [row.stageId], shiftDays: 5 },
        admin,
      );
      expect(result.updated).toBe(1);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe("past events leave both screens", () => {
    it("keeps an event happening today", async () => {
      // The boundary matters: an event today is still live work.
      const event = await makeEvent(0);
      const rows = await listDashboardEvents();
      expect(rows.map((row) => row.id)).toContain(event.id);
    });

    it("drops an event whose date has passed", async () => {
      const event = await makeEvent(-1);
      const rows = await listDashboardEvents();
      expect(rows.map((row) => row.id)).not.toContain(event.id);
    });

    it("drops it from C1 as well", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);
      expect((await listC1Rows()).map((r) => r.eventId)).toContain(event.id);

      // Move the date into the past; it should leave staging too.
      await updateEvent(event.id, { eventDate: addDays(today, -1) }, admin);
      expect((await listC1Rows()).map((r) => r.eventId)).not.toContain(event.id);
    });

    it("hides it immediately, without waiting for maintenance", async () => {
      const event = await makeEvent(-1);

      // Nothing has archived it yet…
      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.archivedAt).toBeNull();

      // …and it is already gone from the board.
      expect((await listDashboardEvents()).map((r) => r.id)).not.toContain(event.id);
    });

    it("cannot be dragged back by a date-range filter", async () => {
      const event = await makeEvent(-5);
      const rows = await listDashboardEvents({ from: addDays(today, -30) });
      expect(rows.map((row) => row.id)).not.toContain(event.id);
    });

    it("archives on maintenance and keeps all its history", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);
      await addNote(event.id, "Worth keeping.", worker);
      const rows = await listC1Rows();
      await updateStage(
        rows.find((r) => r.eventId === event.id)!.stageId,
        { done: true },
        worker,
      );

      await updateEvent(event.id, { eventDate: addDays(today, -1) }, admin);
      const archived = await archivePastEvents(today);
      expect(archived).toBeGreaterThan(0);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.archivedAt).not.toBeNull();

      // The row survives, and so does everything hanging off it — that history
      // is the productivity data.
      expect(await prisma.reviewStage.count({ where: { eventId: event.id } })).toBe(5);
      expect(await prisma.eventNote.count({ where: { eventId: event.id } })).toBe(1);
      expect(
        await prisma.reviewStage.count({ where: { eventId: event.id, status: "DONE" } }),
      ).toBe(1);
      expect(await getCompletionHistory(event.id)).not.toHaveLength(0);
    });

    it("is idempotent — a second run archives nothing new", async () => {
      await makeEvent(-1);
      const first = await archivePastEvents(today);
      const second = await archivePastEvents(today);

      expect(first).toBeGreaterThan(0);
      expect(second).toBe(0);
    });

    it("does not touch events that have not happened yet", async () => {
      const future = await makeEvent(10);
      await archivePastEvents(today);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: future.id } });
      expect(stored.archivedAt).toBeNull();
    });

    it("excludes archived events from the counters", async () => {
      await makeEvent(10);
      await makeEvent(-1);
      await archivePastEvents(today);

      const stats = await getDashboardStats(manager.effective.id);
      expect(stats.total).toBe(1);
      expect(stats.archived).toBe(1);
    });
  });

  describe("promoted events stay on the dashboard", () => {
    it("keeps the event listed once it has gone to C1", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);

      // Hidden from the default view…
      const open = await listDashboardEvents();
      expect(open.map((row) => row.id)).not.toContain(event.id);

      // …but still there as the permanent record.
      const all = await listDashboardEvents({ includePromoted: true });
      const found = all.find((row) => row.id === event.id);
      expect(found).toBeDefined();
      expect(found?.status).toBe("C1");
      expect(found?.completedAt).not.toBeNull();
    });

    it("does not count promoted events as outstanding work", async () => {
      await makeEvent(30);
      const second = await makeEvent(31);
      await completeAndSend(second.id, manager);

      const stats = await getDashboardStats(manager.effective.id);
      expect(stats.total).toBe(1);
      expect(stats.completed).toBe(1);
    });

    it("counts an unticked event as outstanding again, without pulling it out of C1", async () => {
      /*
       * The correction case, from the counter's point of view.
       *
       * "Open" follows the Complete tick rather than the status, because
       * unticking deliberately leaves the event in C1 — the review work must
       * survive — and a status-based count went on calling it finished after
       * the person holding it had said otherwise.
       */
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);
      expect((await getDashboardStats(manager.effective.id)).total).toBe(0);

      await updateEvent(event.id, { complete: false }, manager);

      const stats = await getDashboardStats(manager.effective.id);
      expect(stats.total).toBe(1);

      // And it is still in C1 with every stage intact — the review work is
      // exactly what unticking must not cost.
      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.status).toBe("C1");
      const stages = await stagesFor(event.id);
      expect(stages.length).toBeGreaterThan(0);
      expect(stages.every((stage) => stage.status === "PENDING")).toBe(true);
    });
  });

  describe("completion history", () => {
    it("records every tick and untick with attribution", async () => {
      const event = await makeEvent(30);

      // Tick, untick, tick again. The event stays in C1 throughout — sending
      // it happens once, and the completion is free to change afterwards.
      await completeAndSend(event.id, manager);
      await updateEvent(event.id, { complete: false }, manager);
      await updateEvent(event.id, { complete: true }, worker);

      const history = await getCompletionHistory(event.id);

      // Newest first.
      expect(history).toHaveLength(3);
      expect(history.map((entry) => entry.checked)).toEqual([true, false, true]);
      expect(history[0]!.actorName).toBe("Worker");
      expect(history[2]!.actorName).toBe("Manager");
    });

    it("is empty for an event that was never completed", async () => {
      const event = await makeEvent(30);
      expect(await getCompletionHistory(event.id)).toHaveLength(0);
    });

    it("does not record a no-op re-tick", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);
      await updateEvent(event.id, { complete: true }, manager);

      // Ticking something already ticked changes nothing, so it is not history.
      expect(await getCompletionHistory(event.id)).toHaveLength(1);
    });

    it("records the actor and the impersonated account separately", async () => {
      const event = await makeEvent(30);

      const impersonating = {
        effective: worker.effective,
        real: admin.real,
        isImpersonating: true,
      };
      await completeAndSend(event.id, impersonating);

      const [entry] = await getCompletionHistory(event.id);
      // The administrator is on the hook; the account they were viewing as is
      // recorded alongside, never instead.
      expect(entry!.actorName).toBe("Admin");
      expect(entry!.impersonatedName).toBe("Worker");
    });
  });

  describe("unticking Complete", () => {
    it("is allowed before the event has been sent, and costs nothing", async () => {
      // The correction case: an event is ticked, then something about it turns
      // out to need changing before it goes for review. This is what staleness
      // exists to surface, so it has to be possible.
      const event = await makeEvent(30);
      await updateEvent(event.id, { complete: true }, worker);

      await updateEvent(event.id, { complete: false }, worker);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.completedAt).toBeNull();
      expect(stored.status).toBe("DASHBOARD");
    });

    it("leaves C1 untouched when the event has already been sent", async () => {
      // The rule that matters. Complete records dashboard work; C1 membership
      // is a separate fact. Unticking one must not disturb the other.
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);

      await updateEvent(event.id, { complete: false }, manager);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.completedAt).toBeNull();
      expect(stored.status).toBe("C1");
      expect(await stagesFor(event.id)).toHaveLength(5);
    });

    it("keeps completed review work even when the completion is removed", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);
      const rows = await listC1Rows();
      await updateStage(rows[0]!.stageId, { done: true }, worker);

      // This used to throw, to avoid discarding the stage. Nothing is
      // discarded any more, so there is nothing to refuse.
      await updateEvent(event.id, { complete: false }, manager);

      const stages = await stagesFor(event.id);
      expect(stages.filter((s) => s.status === "DONE")).toHaveLength(1);
      expect(await listC1Rows()).toHaveLength(1);
    });

    it("still refuses to send an unticked event to C1", async () => {
      // The one precondition that survives: sending requires a completion,
      // even though unticking afterwards is allowed.
      const event = await makeEvent(30);

      await expect(sendToC1(event.id, manager)).rejects.toThrow(/Tick Complete first/);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe("deleting an event", () => {
    it("removes it from C1 as well", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);
      expect(await listC1Rows()).toHaveLength(1);

      const result = await deleteEvent(event.id, admin);
      expect(result.outcome).toBe("DELETED");

      expect(await listC1Rows()).toHaveLength(0);
      expect(await stagesFor(event.id)).toHaveLength(0);
    });

    it("cancels rather than deletes once there is completion history", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);
      const rows = await listC1Rows();
      await updateStage(rows[0]!.stageId, { done: true }, worker);

      const result = await deleteEvent(event.id, admin);
      expect(result.outcome).toBe("CANCELLED");

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.status).toBe("CANCELLED");
      // The history survives for reporting.
      expect((await stagesFor(event.id)).filter((s) => s.status === "DONE")).toHaveLength(1);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe("checkbox semantics", () => {
    it("stamps a SeatGeek timestamp and clears it on uncheck", async () => {
      const event = await makeEvent(30);

      const checked = await updateEvent(event.id, { seatGeekChecked: true }, worker);
      expect(checked.event.seatGeekCheckedAt).not.toBeNull();
      expect(checked.event.seatGeekByName).toBe("Worker");

      const cleared = await updateEvent(event.id, { seatGeekChecked: false }, worker);
      expect(cleared.event.seatGeekCheckedAt).toBeNull();
      expect(cleared.event.seatGeekByName).toBeNull();
    });

    it("records TicketData without a timestamp, by design", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { ticketDataChecked: true }, worker);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.ticketDataChecked).toBe(true);
      expect(stored.ticketDataById).toBe(worker.effective.id);
      // There is deliberately no ticketDataCheckedAt column.
      expect("ticketDataCheckedAt" in stored).toBe(false);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe("event details are manager-and-above", () => {
    it("stops a regular user creating an event", async () => {
      await expect(
        createEvent(
          { eventDate: addDays(today, 20), eventTypeId: typeId },
          worker,
        ),
      ).rejects.toThrow(/managers and administrators/i);
    });

    it("stops a regular user editing the date, type, teams or venue", async () => {
      const event = await makeEvent(30);

      for (const patch of [
        { eventDate: addDays(today, 31) },
        { eventTypeId: typeId },
        { awayTeam: "Changed" },
        { homeTeam: "Changed" },
        { venue: "Changed" },
      ]) {
        await expect(updateEvent(event.id, patch, worker)).rejects.toThrow(
          /managers and administrators/i,
        );
      }
    });

    it("still lets a regular user do the operational work", async () => {
      const event = await makeEvent(30);

      // The whole point of the restriction: it must not block day-to-day work.
      await updateEvent(event.id, { seatGeekChecked: true }, worker);
      await updateEvent(event.id, { ticketDataChecked: true }, worker);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);
      await addNote(event.id, "Checked the listings.", worker);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.seatGeekCheckedAt).not.toBeNull();
      expect(stored.ticketDataChecked).toBe(true);
      expect(stored.assigneeId).toBe(worker.effective.id);
    });

    it("lets a manager edit details", async () => {
      const event = await makeEvent(30);
      const result = await updateEvent(event.id, { venue: "New Venue" }, manager);
      expect(result.event.venue).toBe("New Venue");
    });
  });

  describe("flags", () => {
    it("lets any user raise a flag", async () => {
      const event = await makeEvent(30);
      const flagged = await flagEvent(event.id, "Date looks wrong.", worker);

      expect(flagged.flaggedAt).not.toBeNull();
      expect(flagged.flaggedByName).toBe("Worker");
      expect(flagged.flagReason).toBe("Date looks wrong.");
    });

    it("stops a regular user clearing one", async () => {
      const event = await makeEvent(30);
      await flagEvent(event.id, "Needs a look.", worker);

      // A flag its own cause can dismiss is not a flag.
      await expect(resolveFlag(event.id, worker)).rejects.toThrow(/managers/i);
    });

    it("lets a manager clear one", async () => {
      const event = await makeEvent(30);
      await flagEvent(event.id, "Needs a look.", worker);

      const cleared = await resolveFlag(event.id, manager);
      expect(cleared.flaggedAt).toBeNull();
      expect(cleared.flagReason).toBeNull();

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.flagResolvedById).toBe(manager.effective.id);
    });

    it("updates the reason rather than stacking duplicates", async () => {
      const event = await makeEvent(30);
      const first = await flagEvent(event.id, "First reason.", worker);
      const second = await flagEvent(event.id, "Better reason.", worker);

      expect(second.flagReason).toBe("Better reason.");
      // The original raise time is kept — re-flagging is a correction, not a
      // new incident.
      expect(second.flaggedAt).toBe(first.flaggedAt);
    });

    it("refuses to clear a flag that is not raised", async () => {
      const event = await makeEvent(30);
      await expect(resolveFlag(event.id, manager)).rejects.toThrow(/not flagged/i);
    });
  });

  describe("permissions", () => {
    it("lets a regular user claim unassigned work", async () => {
      const event = await makeEvent(30);
      const result = await updateEvent(
        event.id,
        { assigneeId: worker.effective.id },
        worker,
      );
      expect(result.event.assigneeId).toBe(worker.effective.id);
    });

    it("stops a regular user assigning work to someone else", async () => {
      const event = await makeEvent(30);
      await expect(
        updateEvent(event.id, { assigneeId: manager.effective.id }, worker),
      ).rejects.toThrow(/managers/i);
    });

    it("stops a regular user taking work already assigned to someone else", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: manager.effective.id }, manager);

      // The holder must release it, or a manager must move it.
      await expect(
        updateEvent(event.id, { assigneeId: worker.effective.id }, worker),
      ).rejects.toThrow(/managers/i);
    });

    it("stops a regular user releasing someone else's assignment", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: manager.effective.id }, manager);

      await expect(
        updateEvent(event.id, { assigneeId: null }, worker),
      ).rejects.toThrow(/managers/i);
    });

    it("stops a regular user releasing their own assignment", async () => {
      // Claiming a row tells the team it is being dealt with. Quietly
      // withdrawing that leaves the work looking untouched while everyone who
      // saw the claim has moved on, so handing it back goes through a manager.
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);

      await expect(
        updateEvent(event.id, { assigneeId: null }, worker),
      ).rejects.toThrow(/cannot unassign yourself/i);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.assigneeId).toBe(worker.effective.id);
    });

    it("still lets a regular user claim work nobody has taken", async () => {
      const event = await makeEvent(30);

      const claimed = await updateEvent(
        event.id,
        { assigneeId: worker.effective.id },
        worker,
      );
      expect(claimed.event.assigneeId).toBe(worker.effective.id);
    });

    it("stops a regular user taking a row off somebody else", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: manager.effective.id }, manager);

      await expect(
        updateEvent(event.id, { assigneeId: worker.effective.id }, worker),
      ).rejects.toThrow(/only claim work nobody has taken/i);
    });

    it("lets a manager reassign on someone's behalf", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);

      const moved = await updateEvent(
        event.id,
        { assigneeId: manager.effective.id },
        manager,
      );
      expect(moved.event.assigneeId).toBe(manager.effective.id);
    });

    it("lets a manager assign work to anyone", async () => {
      const event = await makeEvent(30);
      const result = await updateEvent(
        event.id,
        { assigneeId: worker.effective.id },
        manager,
      );
      expect(result.event.assigneeId).toBe(worker.effective.id);
    });

    it("refuses to assign a deactivated employee", async () => {
      const inactive = await prisma.user.create({
        data: { email: "gone@test.local", displayName: "Gone", role: "USER", active: false, color: "#64748b" },
      });
      const event = await makeEvent(30);

      await expect(
        updateEvent(event.id, { assigneeId: inactive.id }, manager),
      ).rejects.toThrow(/inactive/i);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe("who may work on a row", () => {
    it("stops a regular user ticking a box on somebody else's event", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: manager.effective.id }, manager);

      await expect(
        updateEvent(event.id, { seatGeekChecked: true }, worker),
      ).rejects.toThrow(/only tick a box on an event assigned to you/i);
    });

    it("leaves unassigned work open to everybody", async () => {
      // Otherwise a row nobody has claimed is a row nobody may touch, which is
      // worse than the problem being solved.
      const event = await makeEvent(30);
      const result = await updateEvent(event.id, { seatGeekChecked: true }, worker);
      expect(result.event.seatGeekCheckedAt).not.toBeNull();
    });

    it("lets the assignee tick their own", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);

      const result = await updateEvent(event.id, { complete: true }, worker);
      expect(result.event.completedAt).not.toBeNull();
    });

    it("lets a manager tick anything", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);

      const result = await updateEvent(event.id, { audited: true }, manager);
      expect(result.event.auditedAt).not.toBeNull();
    });

    it("stops a regular user noting or flagging somebody else's event", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: manager.effective.id }, manager);

      await expect(addNote(event.id, "Mine now", worker)).rejects.toThrow(
        /assigned to you/i,
      );
      await expect(flagEvent(event.id, "Look", worker)).rejects.toThrow(
        /assigned to you/i,
      );
    });
  });

  /* ---------------------------------------------------------------------- */

  describe("completion and in-progress", () => {
    it("clears everyone's in-progress badge when the event is completed", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);
      await startPresence(event.id, "DASHBOARD", worker);
      await startPresence(event.id, "DASHBOARD", manager);

      await updateEvent(event.id, { complete: true }, worker);

      // Both, not just whoever ticked the box: "finished" and "in progress" are
      // contradictory claims about the same row whoever is making them.
      expect(await prisma.presence.count({ where: { eventId: event.id } })).toBe(0);
    });

    it("still allows Start in C1 on an event that is ticked Complete", async () => {
      // Every event in C1 carries a completion — that is what allows it to be
      // sent there — so the Dashboard's "do not start finished work" rule must
      // not reach this screen, or it refuses every row in it.
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);
      await completeAndSend(event.id, manager);

      await startPresence(event.id, "C1", worker);

      const live = await listPresence("C1");
      expect(live.get(event.id)).toHaveLength(1);
    });

    it("still allows Start in C1 on a completed event", async () => {
      // Every event in C1 carries a completion — that is what let it be sent
      // there — so applying the dashboard rule to C1 refused Start on every
      // single row in it.
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);
      await completeAndSend(event.id, manager);

      await startPresence(event.id, "C1", worker);
      expect((await listPresence("C1")).get(event.id)).toHaveLength(1);
    });

    it("counts an unticked event as open again without pulling it out of C1", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);
      await completeAndSend(event.id, manager);

      const whileComplete = await getDashboardStats(worker.effective.id);

      await updateEvent(event.id, { complete: false }, worker);

      const afterUntick = await getDashboardStats(worker.effective.id);

      // Back on the board as outstanding work...
      expect(afterUntick.total).toBe(whileComplete.total + 1);

      // ...while its review carries on untouched. Both are true at once: the
      // Dashboard tracks the preparation, C1 tracks the review of it.
      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.status).toBe("C1");
      expect(await prisma.reviewStage.count({ where: { eventId: event.id } })).toBe(5);
    });

    it("refuses to start an event that is ticked Complete", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);
      await updateEvent(event.id, { complete: true }, worker);

      await expect(
        startPresence(event.id, "DASHBOARD", worker),
      ).rejects.toThrow(/ticked Complete/i);
    });

    it("allows starting a completed event for somebody granted the override", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);
      await updateEvent(event.id, { complete: true }, worker);

      await prisma.user.update({
        where: { id: worker.effective.id },
        data: { canStartCompleted: true },
      });

      await startPresence(event.id, "DASHBOARD", worker);
      const live = await listPresence("DASHBOARD");
      expect(live.get(event.id)).toHaveLength(1);
    });

    it("lets somebody start again once Complete is unticked", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);
      await updateEvent(event.id, { complete: true }, worker);
      await updateEvent(event.id, { complete: false }, worker);

      await startPresence(event.id, "DASHBOARD", worker);
      expect((await listPresence("DASHBOARD")).get(event.id)).toHaveLength(1);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe("notifications", () => {
    const bellFor = (actorContext: ActorContext) => listNotifications(actorContext);

    it("tells the assignee when a manager flags their event", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, manager);

      await flagEvent(event.id, "Numbers do not match", manager);

      const bell = await bellFor(worker);
      expect(bell.unreadCount).toBe(1);
      expect(bell.notifications[0]).toMatchObject({
        kind: "FLAG_RAISED",
        eventId: event.id,
        detail: "Numbers do not match",
        actorName: manager.effective.displayName,
      });
    });

    it("tells the managers when a regular user flags an event", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);

      await flagEvent(event.id, "Escalating this", worker);

      expect((await bellFor(manager)).unreadCount).toBe(1);
      expect((await bellFor(admin)).unreadCount).toBe(1);
      // Never told about their own action.
      expect((await bellFor(worker)).unreadCount).toBe(0);
    });

    it("tells the managers when the assignee says a flag is dealt with", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, manager);
      await flagEvent(event.id, "Please fix", manager);
      await markRead(manager, "ALL");

      await markFlagFixed(event.id, "Re-pulled the file", worker);

      const bell = await bellFor(manager);
      expect(bell.notifications[0]).toMatchObject({
        kind: "FLAG_FIXED",
        detail: "Re-pulled the file",
      });

      // The flag is NOT cleared — it is waiting on a manager to confirm.
      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.flaggedAt).not.toBeNull();
      expect(stored.flagFixedAt).not.toBeNull();
    });

    it("tells whoever raised and whoever fixed it when a manager clears the flag", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, manager);
      await flagEvent(event.id, "Please fix", manager);
      await markFlagFixed(event.id, "Done", worker);

      await resolveFlag(event.id, admin);

      const workerBell = await bellFor(worker);
      expect(workerBell.notifications[0]?.kind).toBe("FLAG_CLEARED");
      const managerBell = await bellFor(manager);
      expect(managerBell.notifications[0]?.kind).toBe("FLAG_CLEARED");

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.flaggedAt).toBeNull();
      expect(stored.flagFixedAt).toBeNull();
    });

    it("refuses a second hand-back while one is already waiting", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, manager);
      await flagEvent(event.id, "Please fix", manager);
      await markFlagFixed(event.id, "Done", worker);

      await expect(markFlagFixed(event.id, "Done again", worker)).rejects.toThrow(
        /already waiting/i,
      );
    });

    it("clears the fixed state when a flag is raised again", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, manager);
      await flagEvent(event.id, "First", manager);
      await markFlagFixed(event.id, "Done", worker);

      // A new problem is not already answered by the last one's fix.
      await flagEvent(event.id, "Second, different problem", manager);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.flagFixedAt).toBeNull();
    });

    it("notifies somebody mentioned in a note", async () => {
      const event = await makeEvent(30);

      await addNote(
        event.id,
        `@${manager.effective.displayName} does this look right to you?`,
        worker,
      );

      const bell = await bellFor(manager);
      expect(bell.notifications[0]).toMatchObject({
        kind: "MENTIONED",
        eventId: event.id,
      });
    });

    it("does not notify for a name that is not written as a mention", async () => {
      const event = await makeEvent(30);
      await addNote(event.id, `Spoke to ${manager.effective.displayName} about it`, worker);
      expect((await bellFor(manager)).unreadCount).toBe(0);
    });

    it("marks one notification read without touching the others", async () => {
      const first = await makeEvent(30);
      const second = await makeEvent(31);
      await updateEvent(first.id, { assigneeId: worker.effective.id }, manager);
      await updateEvent(second.id, { assigneeId: worker.effective.id }, manager);
      await flagEvent(first.id, "One", manager);
      await flagEvent(second.id, "Two", manager);

      const before = await bellFor(worker);
      expect(before.unreadCount).toBe(2);

      await markRead(worker, [before.notifications[0]!.id]);
      expect((await bellFor(worker)).unreadCount).toBe(1);
    });

    it("cannot mark somebody else's notification read", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, manager);
      await flagEvent(event.id, "Yours", manager);

      const workerBell = await bellFor(worker);
      const count = await markRead(manager, [workerBell.notifications[0]!.id]);

      expect(count).toBe(0);
      expect((await bellFor(worker)).unreadCount).toBe(1);
    });

    it("takes its notifications with it when the event is deleted", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, manager);
      await flagEvent(event.id, "Look", manager);
      expect((await bellFor(worker)).unreadCount).toBe(1);

      await deleteEvent(event.id, admin);

      // A notification pointing at a deleted event is a dead link.
      expect((await bellFor(worker)).unreadCount).toBe(0);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe("bulk changes", () => {
    it("refuses a regular user outright", async () => {
      const event = await makeEvent(30);
      await expect(
        planBulkUpdate({ eventIds: [event.id], venue: "New" }, worker),
      ).rejects.toThrow(/managers and administrators/i);
      await expect(
        applyBulkUpdate({ eventIds: [event.id], venue: "New" }, worker),
      ).rejects.toThrow(/managers and administrators/i);
    });

    it("plans without writing anything", async () => {
      const event = await makeEvent(30);

      const plan = await planBulkUpdate(
        { eventIds: [event.id], venue: "Wembley" },
        manager,
      );

      expect(plan.counts.update).toBe(1);
      expect(plan.events[0]?.changes).toEqual([
        { field: "Venue", from: "V", to: "Wembley" },
      ]);
      // A replacement, not an addition — the review screen strikes the old
      // value through only for these.
      expect(plan.events[0]?.changes[0]?.kind).toBeUndefined();

      // The whole point of a preview.
      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.venue).toBe("V");
    });

    it("reports a row that already matches rather than counting it as changed", async () => {
      const event = await makeEvent(30);

      const plan = await planBulkUpdate({ eventIds: [event.id], venue: "V" }, manager);

      expect(plan.counts.update).toBe(0);
      expect(plan.counts.unchanged).toBe(1);
      expect(plan.events[0]?.outcome).toBe("UNCHANGED");
    });

    it("applies several fields at once, and only to the selected events", async () => {
      const target = await makeEvent(30);
      const bystander = await makeEvent(31);

      const result = await applyBulkUpdate(
        {
          eventIds: [target.id],
          venue: "Wembley",
          homeTeam: "Arsenal",
          assigneeId: worker.effective.id,
        },
        manager,
      );

      expect(result.updated).toBe(1);

      const changed = await prisma.event.findUniqueOrThrow({ where: { id: target.id } });
      expect(changed.venue).toBe("Wembley");
      expect(changed.homeTeam).toBe("Arsenal");
      expect(changed.assigneeId).toBe(worker.effective.id);

      const untouched = await prisma.event.findUniqueOrThrow({
        where: { id: bystander.id },
      });
      expect(untouched.venue).toBe("V");
      expect(untouched.assigneeId).toBeNull();
    });

    it("clears a text field when the value is empty", async () => {
      const event = await makeEvent(30);

      const plan = await planBulkUpdate({ eventIds: [event.id], venue: null }, manager);
      expect(plan.events[0]?.changes).toEqual([{ field: "Venue", from: "V", to: null }]);

      await applyBulkUpdate({ eventIds: [event.id], venue: null }, manager);
      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.venue).toBeNull();
    });

    it("shows an added note as gained rather than replacing an empty one", async () => {
      const event = await makeEvent(30);
      await addNote(event.id, "An existing note", worker);

      const plan = await planBulkUpdate(
        { eventIds: [event.id], note: "And another" },
        manager,
      );

      expect(plan.events[0]?.changes).toEqual([
        { field: "Note", from: null, to: "And another", kind: "ADD" },
      ]);

      // And the existing note is genuinely untouched.
      await applyBulkUpdate({ eventIds: [event.id], note: "And another" }, manager);
      const notes = await listNotes(event.id);
      expect(notes.map((note) => note.body).sort()).toEqual([
        "An existing note",
        "And another",
      ]);
    });

    it("adds one note per selected event", async () => {
      const first = await makeEvent(30);
      const second = await makeEvent(31);

      await applyBulkUpdate(
        { eventIds: [first.id, second.id], note: "Checked against the source file." },
        manager,
      );

      for (const event of [first, second]) {
        const notes = await listNotes(event.id);
        expect(notes.map((note) => note.body)).toEqual([
          "Checked against the source file.",
        ]);
      }
    });

    it("keeps the original flaggedAt when re-flagging, and updates the reason", async () => {
      const event = await makeEvent(30);
      await flagEvent(event.id, "First look", worker);
      const first = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });

      await applyBulkUpdate(
        { eventIds: [event.id], flag: { action: "RAISE", reason: "Second look" } },
        manager,
      );

      const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(after.flagReason).toBe("Second look");
      // Re-flagging must not reset how long it has been waiting.
      expect(after.flaggedAt?.getTime()).toBe(first.flaggedAt?.getTime());
    });

    it("stamps flaggedAt on a row that was not already flagged", async () => {
      const clean = await makeEvent(30);
      const flagged = await makeEvent(31);
      await flagEvent(flagged.id, "Old", worker);

      await applyBulkUpdate(
        { eventIds: [clean.id, flagged.id], flag: { action: "RAISE", reason: "Both" } },
        manager,
      );

      const after = await prisma.event.findUniqueOrThrow({ where: { id: clean.id } });
      expect(after.flaggedAt).not.toBeNull();
      expect(after.flagReason).toBe("Both");
    });

    it("clears flags in bulk", async () => {
      const event = await makeEvent(30);
      await flagEvent(event.id, "Look at this", worker);

      await applyBulkUpdate({ eventIds: [event.id], flag: { action: "CLEAR" } }, manager);

      const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(after.flaggedAt).toBeNull();
      expect(after.flagReason).toBeNull();
      expect(after.flagResolvedAt).not.toBeNull();
    });

    it("cancels an event with completed review work instead of deleting it", async () => {
      const plain = await makeEvent(30);
      const reviewed = await makeEvent(31);
      await completeAndSend(reviewed.id, manager);
      const stages = await stagesFor(reviewed.id);
      await updateStage(stages[0]!.id, { done: true }, manager);

      const plan = await planBulkUpdate(
        { eventIds: [plain.id, reviewed.id], remove: true },
        manager,
      );
      expect(plan.counts.delete).toBe(1);
      expect(plan.counts.cancel).toBe(1);
      expect(plan.warnings.some((warning) => /cancelled rather than deleted/i.test(warning)))
        .toBe(true);

      const result = await applyBulkUpdate(
        { eventIds: [plain.id, reviewed.id], remove: true },
        manager,
      );
      expect(result).toMatchObject({ deleted: 1, cancelled: 1 });

      expect(await prisma.event.findUnique({ where: { id: plain.id } })).toBeNull();
      const kept = await prisma.event.findUniqueOrThrow({ where: { id: reviewed.id } });
      expect(kept.status).toBe("CANCELLED");
    });

    it("refuses to delete and edit in one action", async () => {
      const event = await makeEvent(30);
      await expect(
        applyBulkUpdate({ eventIds: [event.id], remove: true, venue: "X" }, manager),
      ).rejects.toThrow(/cannot be combined/i);
    });

    it("skips cancelled events rather than editing them", async () => {
      const event = await makeEvent(30);
      await prisma.event.update({
        where: { id: event.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });

      const plan = await planBulkUpdate({ eventIds: [event.id], venue: "X" }, manager);
      expect(plan.counts.skip).toBe(1);
      expect(plan.events[0]?.reason).toMatch(/cancelled/i);

      await expect(
        applyBulkUpdate({ eventIds: [event.id], venue: "X" }, manager),
      ).rejects.toThrow(/nothing to apply/i);
    });

    it("refuses an inactive assignee before touching anything", async () => {
      const gone = await prisma.user.create({
        data: { email: "bulk-gone@test.local", displayName: "Gone", role: "USER", active: false, color: "#64748b" },
      });
      const event = await makeEvent(30);

      await expect(
        applyBulkUpdate({ eventIds: [event.id], assigneeId: gone.id }, manager),
      ).rejects.toThrow(/inactive/i);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.assigneeId).toBeNull();
    });

    it("refuses an empty selection and an empty change", async () => {
      const event = await makeEvent(30);
      await expect(planBulkUpdate({ eventIds: [] }, manager)).rejects.toThrow(
        /at least one event/i,
      );
      await expect(planBulkUpdate({ eventIds: [event.id] }, manager)).rejects.toThrow(
        /at least one change/i,
      );
    });

    it("reports events somebody else deleted while they were being selected", async () => {
      const kept = await makeEvent(30);
      const vanished = await makeEvent(31);
      await prisma.event.delete({ where: { id: vanished.id } });

      const plan = await planBulkUpdate(
        { eventIds: [kept.id, vanished.id], venue: "X" },
        manager,
      );

      expect(plan.events).toHaveLength(1);
      expect(plan.warnings.some((warning) => /deleted by somebody else/i.test(warning)))
        .toBe(true);
    });

    it("records one audit entry for the action rather than one per row", async () => {
      const first = await makeEvent(30);
      const second = await makeEvent(31);

      await applyBulkUpdate({ eventIds: [first.id, second.id], venue: "X" }, manager);

      const entries = await prisma.auditLog.findMany({ where: { action: "BULK_UPDATE" } });
      expect(entries).toHaveLength(1);
      expect((entries[0]?.newValue as { eventIds: string[] }).eventIds).toHaveLength(2);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe("starting work", () => {
    it("stops a regular user starting on unassigned work", async () => {
      const event = await makeEvent(30);

      await expect(
        startPresence(event.id, "DASHBOARD", worker),
      ).rejects.toThrow(/assign this to yourself/i);

      expect(await prisma.presence.count({ where: { eventId: event.id } })).toBe(0);
    });

    it("stops a regular user starting on somebody else's work", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: manager.effective.id }, manager);

      await expect(
        startPresence(event.id, "DASHBOARD", worker),
      ).rejects.toThrow(/assigned to you/i);
    });

    it("lets a regular user start once they hold the event", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);

      await startPresence(event.id, "DASHBOARD", worker);

      const live = await listPresence("DASHBOARD");
      expect(live.get(event.id)?.map((entry) => entry.userId)).toEqual([
        worker.effective.id,
      ]);
    });

    it("lets a manager start on anything", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);

      await startPresence(event.id, "C1", manager);

      const live = await listPresence("C1");
      expect(live.get(event.id)?.map((entry) => entry.userId)).toEqual([
        manager.effective.id,
      ]);
    });

    it("shows a manager everyone's claims, across both screens, oldest first", async () => {
      const older = await makeEvent(30);
      const newer = await makeEvent(31);
      await updateEvent(older.id, { assigneeId: worker.effective.id }, worker);

      await startPresence(older.id, "DASHBOARD", worker);
      // Ensure a distinct startedAt rather than relying on clock resolution.
      await prisma.presence.updateMany({
        where: { eventId: older.id },
        data: { startedAt: new Date(Date.now() - 90 * 60_000) },
      });
      await startPresence(newer.id, "C1", manager);

      const team = await listTeamPresence();

      expect(team.map((entry) => entry.eventId)).toEqual([older.id, newer.id]);
      expect(team[0]?.userName).toBe(worker.effective.displayName);
      expect(team[0]?.context).toBe("DASHBOARD");
      expect(team[0]?.minutesActive).toBe(90);
      expect(team[1]?.context).toBe("C1");
      // The event has to be identifiable without opening it.
      expect(team[0]?.label.length).toBeGreaterThan(0);
      expect(team[0]?.eventDate).toBe(older.eventDate);
    });

    it("leaves an expired claim out of the team view", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);
      await startPresence(event.id, "DASHBOARD", worker);

      // Stopped beating well beyond any plausible timeout.
      await prisma.presence.updateMany({
        where: { eventId: event.id },
        data: { lastHeartbeat: new Date(Date.now() - 24 * 60 * 60_000) },
      });

      expect(await listTeamPresence()).toEqual([]);
    });

    it("lets somebody stop after the event is moved away from them", async () => {
      // A claim outlives the assignment behind it. Gating the stop as well
      // would strand its owner with an indicator they cannot clear.
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);
      await startPresence(event.id, "DASHBOARD", worker);

      await updateEvent(event.id, { assigneeId: manager.effective.id }, manager);
      await stopPresence(event.id, "DASHBOARD", worker);

      const live = await listPresence("DASHBOARD");
      expect(live.get(event.id) ?? []).toEqual([]);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe("concurrent edits", () => {
    it("changing the assignee does not clear a SeatGeek check made a moment earlier", async () => {
      const event = await makeEvent(30);

      const afterCheck = await updateEvent(event.id, { seatGeekChecked: true }, worker);
      expect(afterCheck.event.seatGeekCheckedAt).not.toBeNull();

      // A different person patches only the assignee, from a stale view.
      const afterAssign = await updateEvent(
        event.id,
        { assigneeId: worker.effective.id },
        manager,
      );

      expect(afterAssign.event.assigneeId).toBe(worker.effective.id);
      expect(afterAssign.event.seatGeekCheckedAt).toBe(afterCheck.event.seatGeekCheckedAt);
    });

    it("survives simultaneous updates to different fields", async () => {
      const event = await makeEvent(30);

      await Promise.all([
        updateEvent(event.id, { seatGeekChecked: true }, worker),
        updateEvent(event.id, { ticketDataChecked: true }, manager),
        updateEvent(event.id, { venue: "New Venue" }, manager),
      ]);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.seatGeekCheckedAt).not.toBeNull();
      expect(stored.ticketDataChecked).toBe(true);
      expect(stored.venue).toBe("New Venue");
    });
  });

  /* ---------------------------------------------------------------------- */

  describe("notes", () => {
    it("keeps each note attributed to its own author", async () => {
      const event = await makeEvent(30);

      await addNote(event.id, "First look done.", worker);
      await addNote(event.id, "Pricing checked.", manager);

      const notes = await listNotes(event.id);
      expect(notes).toHaveLength(2);
      // Newest first.
      expect(notes[0]!.authorName).toBe("Manager");
      expect(notes[1]!.authorName).toBe("Worker");
      expect(notes[0]!.authorColor).toBe("#059669");
    });

    it("rejects an empty note", async () => {
      const event = await makeEvent(30);
      await expect(addNote(event.id, "   ", worker)).rejects.toThrow();
    });
  });

  /* ---------------------------------------------------------------------- */

/* ---------------------------------------------------------------------- */

  describe("metrics scoped to one person", () => {
    /** Two people each complete a distinguishable number of events. */
    async function seedCompletions() {
      for (let i = 0; i < 3; i += 1) {
        const event = await makeEvent(20 + i);
        await updateEvent(event.id, { complete: true }, worker);
      }
      for (let i = 0; i < 5; i += 1) {
        const event = await makeEvent(40 + i);
        await updateEvent(event.id, { complete: true }, manager);
      }
    }

    it("reports the whole team when nobody is named", async () => {
      await seedCompletions();

      const metrics = await getMetrics("THIS_WEEK");

      expect(metrics.totals.eventsCompleted).toBe(8);
      expect(metrics.users.length).toBeGreaterThan(1);
    });

    it("reports only that person's work when one is named", async () => {
      await seedCompletions();

      const metrics = await getMetrics("THIS_WEEK", { onlyUserId: worker.effective.id });

      expect(metrics.users).toHaveLength(1);
      expect(metrics.users[0]!.userId).toBe(worker.effective.id);
      expect(metrics.users[0]!.eventsCompleted).toBe(3);
    });

    it("narrows the shared totals too, not just the per-person rows", async () => {
      // Leaving "8 events completed" beside a bar of 3 would report the team's
      // output on a page claiming to be about one person.
      await seedCompletions();

      const metrics = await getMetrics("THIS_WEEK", { onlyUserId: worker.effective.id });

      expect(metrics.totals.eventsCompleted).toBe(3);
    });

    it("never carries another person's figures in the response at all", async () => {
      // The scoping is in the query, so somebody else's numbers are not merely
      // hidden — they are never computed or sent.
      await seedCompletions();

      const metrics = await getMetrics("THIS_WEEK", { onlyUserId: worker.effective.id });
      const serialised = JSON.stringify(metrics);

      expect(serialised).not.toContain(manager.effective.id);
      expect(serialised).not.toContain("Manager");
    });

    it("still reports a person who did nothing, rather than an empty page", async () => {
      await seedCompletions();

      const metrics = await getMetrics("THIS_WEEK", { onlyUserId: admin.effective.id });

      expect(metrics.users).toHaveLength(1);
      expect(metrics.users[0]!.eventsCompleted).toBe(0);
      expect(metrics.totals.eventsCompleted).toBe(0);
    });
  });

/* ---------------------------------------------------------------------- */

  describe("drilling through from a metrics bar", () => {
    it("returns exactly the events that person completed", async () => {
      const mine = await makeEvent(20);
      const theirs = await makeEvent(25);
      await updateEvent(mine.id, { complete: true }, worker);
      await updateEvent(theirs.id, { complete: true }, manager);

      const rows = await listDashboardEvents({ completedById: worker.effective.id });

      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(mine.id);
    });

    it("agrees with the number the chart showed", async () => {
      // The property that matters: a bar of three must not open a page of two.
      for (let i = 0; i < 3; i += 1) {
        const event = await makeEvent(20 + i);
        await updateEvent(event.id, { complete: true }, worker);
      }

      const metrics = await getMetrics("THIS_WEEK", { onlyUserId: worker.effective.id });
      const rows = await listDashboardEvents({
        completedById: worker.effective.id,
        ...(metrics.from ? { completedFrom: metrics.from } : {}),
        completedTo: metrics.to,
      });

      expect(rows).toHaveLength(metrics.totals.eventsCompleted);
    });

    it("finds a completion made late in the business day", async () => {
      // The bug this replaced used UTC boundaries. In Caracas, 21:38 is 01:38
      // the next day in UTC, so an evening of work fell outside a window that
      // the chart counted inside it.
      const event = await makeEvent(20);
      await updateEvent(event.id, { complete: true }, worker);

      await prisma.event.update({
        where: { id: event.id },
        // 20:30 Caracas today, which is tomorrow in UTC.
        data: { completedAt: new Date(new Date(today + "T00:00:00Z").getTime() + 86_400_000 + 30 * 60_000) },
      });

      const rows = await listDashboardEvents({
        completedById: worker.effective.id,
        completedFrom: today,
        completedTo: today,
      });

      expect(rows).toHaveLength(1);
    });

    it("shows completed events even though they are hidden by default", async () => {
      // The dashboard defaults to outstanding work. A drill-through asks about
      // finished work, so those defaults must not apply.
      const event = await makeEvent(20);
      await completeAndSend(event.id, worker);

      const plain = await listDashboardEvents({});
      const drilled = await listDashboardEvents({ completedById: worker.effective.id });

      expect(plain.map((r) => r.id)).not.toContain(event.id);
      expect(drilled.map((r) => r.id)).toContain(event.id);
    });
  });

/* ---------------------------------------------------------------------- */

  describe("review work done", () => {
    /** Tick every stage on an event, which is what removes it from C1. */
    async function finishAllStages(eventId: string, actor: typeof worker) {
      for (;;) {
        const rows = await listC1Rows();
        const row = rows.find((r) => r.eventId === eventId);
        if (!row) return;
        await updateStage(row.stageId, { done: true }, actor);
      }
    }

    it("still finds the work after the event has left C1", async () => {
      // The bug this replaced: the drill-through filtered on events *currently*
      // in C1, and finishing the reviews is exactly what takes an event out of
      // it — so clicking a bar of real work opened an empty page.
      const event = await makeEvent(30);
      await completeAndSend(event.id, worker);
      await finishAllStages(event.id, worker);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.status).not.toBe("C1");

      const done = await listCompletedStages({ doneById: worker.effective.id });
      expect(done).toHaveLength(5);
      expect(done.every((row) => row.eventId === event.id)).toBe(true);
    });

    it("reports one row per checkpoint, not per event", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, worker);

      const rows = await listC1Rows();
      await updateStage(rows[0]!.stageId, { done: true }, worker);

      const done = await listCompletedStages({ doneById: worker.effective.id });
      expect(done).toHaveLength(1);
      expect(done[0]!.offsetDays).toBe(21);
    });

    it("keeps one person's work separate from another's", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);

      const rows = await listC1Rows();
      await updateStage(rows[0]!.stageId, { done: true }, worker);
      const next = await listC1Rows();
      await updateStage(next[0]!.stageId, { done: true }, manager);

      expect(await listCompletedStages({ doneById: worker.effective.id })).toHaveLength(1);
      expect(await listCompletedStages({ doneById: manager.effective.id })).toHaveLength(1);
    });

    it("agrees with the number the metrics bar showed", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, worker);
      await finishAllStages(event.id, worker);

      const metrics = await getMetrics("THIS_WEEK", { onlyUserId: worker.effective.id });
      const done = await listCompletedStages({
        doneById: worker.effective.id,
        ...(metrics.from ? { from: metrics.from } : {}),
        to: metrics.to,
      });

      expect(done).toHaveLength(metrics.totals.stagesDone);
    });

    it("says where the event ended up, so finished work is not read as live", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, worker);
      await finishAllStages(event.id, worker);

      const done = await listCompletedStages({ doneById: worker.effective.id });
      expect(done[0]!.eventStatus).toBe("COMPLETED");
    });
  });

  describe("database constraints", () => {
    it("refuses a DONE stage with no completion instant", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);
      const stage = (await stagesFor(event.id))[0]!;

      // The coherence constraint is what caught a real ordering bug before.
      await expect(
        prisma.reviewStage.update({
          where: { id: stage.id },
          data: { status: "DONE", doneAt: null },
        }),
      ).rejects.toThrow();
    });

    it("refuses a duplicate stage for the same event", async () => {
      const event = await makeEvent(30);
      await completeAndSend(event.id, manager);

      await expect(
        prisma.reviewStage.create({
          data: {
            eventId: event.id,
            offsetDays: 21,
            reviewDue: dbDateFromPlainDate(toPlainDate(today)),
          },
        }),
      ).rejects.toThrow();
    });

    it("refuses a malformed user color", async () => {
      await expect(
        prisma.user.create({
          data: { email: "bad@test.local", displayName: "Bad", color: "red" },
        }),
      ).rejects.toThrow();
    });
  });
});
