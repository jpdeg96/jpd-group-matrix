/**
 * The change signal behind live updates.
 *
 * Every one of these is a case where a stale screen would be shown to a
 * teammate — so each is really asking "would the other person have seen this?"
 */

import { beforeEach, describe, expect, it } from "vitest";
import { computeRevision, revisionToken } from "@/lib/services/data-revision";
import { prisma } from "@/lib/db/prisma";

const token = async () => revisionToken(await computeRevision());

async function seedEvent(over: { awayTeam?: string } = {}) {
  const type =
    (await prisma.eventType.findFirst()) ??
    (await prisma.eventType.create({ data: { name: "NFL", sortOrder: 0 } }));

  return prisma.event.create({
    data: {
      eventDate: new Date("2026-12-01"),
      eventTypeId: type.id,
      awayTeam: over.awayTeam ?? "Away",
      homeTeam: "Home",
      venue: "Somewhere",
    },
  });
}

beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.presence.deleteMany();
  await prisma.eventNote.deleteMany();
  await prisma.reviewStage.deleteMany();
  await prisma.event.deleteMany();
  await prisma.eventType.deleteMany();
  await prisma.user.deleteMany();
});

describe("the revision token", () => {
  it("is stable when nothing happens", async () => {
    await seedEvent();
    expect(await token()).toBe(await token());
  });

  it("moves when an event is created", async () => {
    const before = await token();
    await seedEvent();
    expect(await token()).not.toBe(before);
  });

  it("moves when an event is edited", async () => {
    const event = await seedEvent();
    const before = await token();
    await prisma.event.update({ where: { id: event.id }, data: { venue: "Elsewhere" } });
    expect(await token()).not.toBe(before);
  });

  it("moves when an event is completed", async () => {
    // The headline case: someone ticks Complete and it must reach everyone.
    const event = await seedEvent();
    const before = await token();
    await prisma.event.update({
      where: { id: event.id },
      data: { completedAt: new Date(), status: "C1" },
    });
    expect(await token()).not.toBe(before);
  });

  it("moves when an event is DELETED", async () => {
    // The case a MAX(updated_at) alone would miss entirely: deleting a row
    // lowers no maximum and touches no timestamp. Only the count catches it.
    const event = await seedEvent();
    const before = await token();
    await prisma.event.delete({ where: { id: event.id } });
    expect(await token()).not.toBe(before);
  });

  it("moves when a review stage is added, as promotion to C1 does", async () => {
    const event = await seedEvent();
    const before = await token();
    await prisma.reviewStage.create({
      data: { eventId: event.id, offsetDays: 21, reviewDue: new Date("2026-11-10") },
    });
    expect(await token()).not.toBe(before);
  });

  it("moves when a review stage is ticked Done", async () => {
    const event = await seedEvent();
    const user = await prisma.user.create({
      data: { email: "a@jpdgroup.net", displayName: "A", color: "#2563eb" },
    });
    const stage = await prisma.reviewStage.create({
      data: { eventId: event.id, offsetDays: 21, reviewDue: new Date("2026-11-10") },
    });
    const before = await token();

    await prisma.reviewStage.update({
      where: { id: stage.id },
      data: { status: "DONE", doneAt: new Date(), doneById: user.id },
    });
    expect(await token()).not.toBe(before);
  });

  it("moves when a note is added", async () => {
    const event = await seedEvent();
    const before = await token();
    await prisma.eventNote.create({ data: { eventId: event.id, body: "Something." } });
    expect(await token()).not.toBe(before);
  });

  it("moves when a note is edited", async () => {
    const event = await seedEvent();
    const note = await prisma.eventNote.create({
      data: { eventId: event.id, body: "First." },
    });
    const before = await token();

    // An explicit later instant rather than `new Date()`. Notes carry no
    // `updated_at`, so the token takes the larger of createdAt and editedAt —
    // and a test that creates then immediately edits can land both in the same
    // millisecond, which made this fail intermittently. The real path cannot:
    // editing requires a human round-trip through the dialog. Pinning the time
    // tests the rule instead of the machine's clock resolution.
    await prisma.eventNote.update({
      where: { id: note.id },
      data: { body: "Second.", editedAt: new Date(Date.now() + 1_000) },
    });

    expect(await token()).not.toBe(before);
  });

  it("moves when a note is deleted", async () => {
    const event = await seedEvent();
    const note = await prisma.eventNote.create({
      data: { eventId: event.id, body: "Temporary." },
    });
    const before = await token();
    await prisma.eventNote.delete({ where: { id: note.id } });
    expect(await token()).not.toBe(before);
  });

  it("does not move for presence, which has its own channel", async () => {
    // Presence changes constantly as people claim rows. Folding it in here
    // would make every claim refresh every table for everyone.
    const event = await seedEvent();
    const user = await prisma.user.create({
      data: { email: "b@jpdgroup.net", displayName: "B", color: "#0891b2" },
    });
    const before = await token();

    await prisma.presence.create({
      data: { userId: user.id, eventId: event.id, context: "DASHBOARD" },
    });
    expect(await token()).toBe(before);
  });

  it("does not move for an audit entry alone", async () => {
    // Audit rows accompany real changes; the change itself is what is tracked.
    const user = await prisma.user.create({
      data: { email: "c@jpdgroup.net", displayName: "C", color: "#059669" },
    });
    const event = await seedEvent();
    const before = await token();

    await prisma.auditLog.create({
      data: { userId: user.id, entityType: "EVENT", entityId: event.id, action: "VIEWED" },
    });
    expect(await token()).toBe(before);
  });
});
