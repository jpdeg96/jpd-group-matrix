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
import {
  createEvent,
  deleteEvent,
  flagEvent,
  getCompletionHistory,
  getDashboardStats,
  listDashboardEvents,
  resolveFlag,
  updateEvent,
} from "@/lib/services/events";
import {
  bulkUpdateReviewDue,
  listC1Rows,
  updateStage,
} from "@/lib/services/stages";
import { addNote, listNotes } from "@/lib/services/notes";
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

  describe("promotion into C1", () => {
    it("stays on the dashboard until Complete is ticked", async () => {
      const event = await makeEvent(30);
      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });

      expect(stored.status).toBe("DASHBOARD");
      expect(await stagesFor(event.id)).toHaveLength(0);
    });

    it("ticking Complete promotes it and generates every stage", async () => {
      const event = await makeEvent(30);
      const result = await updateEvent(event.id, { complete: true }, manager);

      expect(result.promoted).toBe(true);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.status).toBe("C1");
      expect(stored.completedAt).not.toBeNull();
      expect(stored.completedById).toBe(manager.effective.id);

      const stages = await stagesFor(event.id);
      expect(stages.map((s) => s.offsetDays)).toEqual([21, 14, 7, 5, 1]);
      expect(stages.every((s) => s.status === "PENDING")).toBe(true);
    });

    it("marks stages already past at promotion as SKIPPED, not PENDING", async () => {
      // Completed 10 days out: D-21 and D-14 were never actionable.
      const event = await makeEvent(10);
      await updateEvent(event.id, { complete: true }, manager);

      const stages = await stagesFor(event.id);
      const skipped = stages.filter((s) => s.status === "SKIPPED").map((s) => s.offsetDays);
      const pending = stages.filter((s) => s.status === "PENDING").map((s) => s.offsetDays);

      expect(skipped).toEqual([21, 14]);
      expect(pending).toEqual([7, 5, 1]);
    });

    it("is idempotent — re-ticking Complete does not duplicate stages", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { complete: true }, manager);
      await updateEvent(event.id, { complete: true }, manager);

      expect(await stagesFor(event.id)).toHaveLength(5);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe("C1 shows one row per event, on its current stage", () => {
    it("starts on the furthest-out stage and advances as each is done", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { complete: true }, manager);

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
      await updateEvent(event.id, { complete: true }, manager);

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
      await updateEvent(event.id, { complete: true }, manager);

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
      await updateEvent(event.id, { complete: true }, manager);
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
      await updateEvent(event.id, { complete: true }, manager);
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
      await updateEvent(event.id, { complete: true }, manager);
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
      await updateEvent(event.id, { complete: true }, manager);
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
      await updateEvent(event.id, { complete: true }, manager);
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
      await updateEvent(event.id, { complete: true }, manager);
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
      await updateEvent(event.id, { complete: true }, manager);

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
      await updateEvent(second.id, { complete: true }, manager);

      const stats = await getDashboardStats(manager.effective.id);
      expect(stats.total).toBe(1);
      expect(stats.completed).toBe(1);
    });
  });

  describe("completion history", () => {
    it("records every tick and untick with attribution", async () => {
      const event = await makeEvent(30);

      await updateEvent(event.id, { complete: true }, manager);
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
      await updateEvent(event.id, { complete: true }, manager);
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
      await updateEvent(event.id, { complete: true }, impersonating);

      const [entry] = await getCompletionHistory(event.id);
      // The administrator is on the hook; the account they were viewing as is
      // recorded alongside, never instead.
      expect(entry!.actorName).toBe("Admin");
      expect(entry!.impersonatedName).toBe("Worker");
    });
  });

  describe("returning an event to the dashboard", () => {
    it("allows undo while no stage work has happened", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { complete: true }, manager);

      const result = await updateEvent(event.id, { complete: false }, manager);
      expect(result.demoted).toBe(true);

      const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(stored.status).toBe("DASHBOARD");
      expect(stored.completedAt).toBeNull();
      expect(await stagesFor(event.id)).toHaveLength(0);
    });

    it("refuses once a stage has been completed, rather than discarding the work", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { complete: true }, manager);
      const rows = await listC1Rows();
      await updateStage(rows[0]!.stageId, { done: true }, worker);

      await expect(
        updateEvent(event.id, { complete: false }, manager),
      ).rejects.toThrow(/completed review stage/i);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe("deleting an event", () => {
    it("removes it from C1 as well", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { complete: true }, manager);
      expect(await listC1Rows()).toHaveLength(1);

      const result = await deleteEvent(event.id, admin);
      expect(result.outcome).toBe("DELETED");

      expect(await listC1Rows()).toHaveLength(0);
      expect(await stagesFor(event.id)).toHaveLength(0);
    });

    it("cancels rather than deletes once there is completion history", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { complete: true }, manager);
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

    it("lets a regular user release their own assignment", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { assigneeId: worker.effective.id }, worker);

      const released = await updateEvent(event.id, { assigneeId: null }, worker);
      expect(released.event.assigneeId).toBeNull();
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

  describe("database constraints", () => {
    it("refuses a DONE stage with no completion instant", async () => {
      const event = await makeEvent(30);
      await updateEvent(event.id, { complete: true }, manager);
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
      await updateEvent(event.id, { complete: true }, manager);

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
