/**
 * Development seed data.
 *
 *   npm run db:seed
 *
 * Builds a database that exercises the interesting cases: events waiting on the
 * dashboard, events promoted into C1 at different stages, a weekend collapse, a
 * deactivated user still attached to historical work, and notes from several
 * people on the same event.
 *
 * Every date is relative to today in the configured business timezone, so the
 * fixture stays meaningful whenever it is run.
 *
 * DESTRUCTIVE: clears events, stages, notes, presence and audit logs.
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db/prisma";
import {
  addDays,
  dayOfWeek,
  dbDateFromPlainDate,
  formatPlainDateWithWeekday,
  Weekday,
  type PlainDate,
} from "../lib/date/plain-date";
import { buildReviewSchedule } from "../lib/domain/review-schedule";
import { businessToday, getScheduleConfig, getSettings } from "../lib/services/settings";
import { USER_COLOR_PALETTE } from "../lib/domain/constants";
import { suggestEmoji } from "../lib/services/event-types";

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "phantom1234";

async function main() {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_PRODUCTION_SEED) {
    throw new Error(
      "Refusing to seed a production database. Set ALLOW_PRODUCTION_SEED=1 to override.",
    );
  }

  const settings = await getSettings();
  const today = await businessToday();
  const config = await getScheduleConfig();

  console.log(`Seeding against ${today} (${settings.timeZone})\n`);

  await prisma.auditLog.deleteMany();
  await prisma.presence.deleteMany();
  await prisma.eventNote.deleteMany();
  await prisma.reviewStage.deleteMany();
  await prisma.event.deleteMany();
  await prisma.eventType.deleteMany();

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);

  const people = [
    { email: "admin@jpdgroup.test", displayName: "Avery Chen", role: "ADMIN" as const, active: true },
    { email: "morgan@jpdgroup.test", displayName: "Morgan Diaz", role: "MANAGER" as const, active: true },
    { email: "dana@jpdgroup.test", displayName: "Dana Whitfield", role: "USER" as const, active: true },
    { email: "marco@jpdgroup.test", displayName: "Marco Ruiz", role: "USER" as const, active: true },
    { email: "priya@jpdgroup.test", displayName: "Priya Raman", role: "USER" as const, active: true },
    // Deactivated: must stay visible on historical work but be unselectable.
    { email: "jordan@jpdgroup.test", displayName: "Jordan Blake", role: "USER" as const, active: false },
  ];

  const users = await Promise.all(
    people.map((person, index) =>
      prisma.user.upsert({
        where: { email: person.email },
        update: {
          displayName: person.displayName,
          role: person.role,
          active: person.active,
          color: USER_COLOR_PALETTE[index % USER_COLOR_PALETTE.length]!,
          passwordHash,
        },
        create: {
          ...person,
          color: USER_COLOR_PALETTE[index % USER_COLOR_PALETTE.length]!,
          passwordHash,
        },
      }),
    ),
  );

  const [avery, morgan, dana, marco, priya, jordan] = users as [
    (typeof users)[number], (typeof users)[number], (typeof users)[number],
    (typeof users)[number], (typeof users)[number], (typeof users)[number],
  ];

  console.log(`Users: ${users.length} (password for all: "${SEED_PASSWORD}")`);

  const typeNames = ["NFL", "NBA", "NHL", "MLB", "Concert", "Theatre"];
  const types = await Promise.all(
    typeNames.map((name, index) =>
      prisma.eventType.create({
        // Emoji comes from the same suggester the app uses, so the seed and a
        // hand-created type behave identically.
        data: { name, emoji: suggestEmoji(name), sortOrder: index },
      }),
    ),
  );
  const typeByName = new Map(types.map((type) => [type.name, type.id]));
  console.log(`Event types: ${typeNames.join(", ")}`);

  /**
   * An event held on a Friday makes two stages collapse onto one Friday: D-7
   * lands on the previous Friday, and D-5 lands on the Sunday after it, which
   * the weekend rule moves back onto that same Friday. Both stages still exist.
   */
  const fridayEvent = findNextWeekday(addDays(today, 24), Weekday.Friday);

  /* ---------------------------------------------------------------------- */
  /* Dashboard events                                                        */
  /* ---------------------------------------------------------------------- */

  const dashboardSpecs = [
    { label: "far out", date: addDays(today, 60), type: "NFL", away: "Kansas City Chiefs", home: "Buffalo Bills", venue: "Highmark Stadium", assignee: dana.id },
    { label: "weekend collapse when promoted", date: fridayEvent, type: "MLB", away: "Los Angeles Dodgers", home: "Chicago Cubs", venue: "Wrigley Field", assignee: marco.id },
    { label: "unassigned", date: addDays(today, 30), type: "NBA", away: "Denver Nuggets", home: "Boston Celtics", venue: "TD Garden", assignee: null },
    { label: "single artist, no home team", date: addDays(today, 40), type: "Concert", away: "Bad Bunny", home: null, venue: "Estadio Monumental", assignee: priya.id },
    { label: "theatre run", date: addDays(today, 18), type: "Theatre", away: "Hamilton", home: null, venue: "Teatro Teresa Carreño", assignee: dana.id },
    { label: "past dated, never completed — flagged", date: addDays(today, -6), type: "NHL", away: "Colorado Avalanche", home: "Dallas Stars", venue: "American Airlines Center", assignee: null },
  ];

  for (const spec of dashboardSpecs) {
    const event = await prisma.event.create({
      data: {
        eventDate: dbDateFromPlainDate(spec.date),
        eventTypeId: typeByName.get(spec.type)!,
        awayTeam: spec.away,
        homeTeam: spec.home,
        venue: spec.venue,
        assigneeId: spec.assignee,
        status: "DASHBOARD",
        // A couple of rows arrive with marketplace work already done.
        ...(spec.type === "NFL"
          ? {
              seatGeekCheckedAt: new Date(),
              seatGeekById: dana.id,
              ticketDataChecked: true,
              ticketDataById: dana.id,
            }
          : {}),
      },
    });

    console.log(`  dashboard ${spec.date}  ${formatPlainDateWithWeekday(spec.date).padEnd(12)} ${spec.label}`);

    // One flagged event, raised by a base user, so the manager-review path is
    // visible immediately.
    if (spec.type === "NHL") {
      await prisma.event.update({
        where: { id: event.id },
        data: {
          flaggedAt: new Date(),
          flaggedById: dana.id,
          flagReason: "Date looks wrong — this event has already happened.",
        },
      });
    }

    if (spec.type === "MLB") {
      // Several people on one event — the exact case a single notes field made
      // impossible to read.
      await prisma.eventNote.createMany({
        data: [
          { eventId: event.id, authorId: dana.id, body: "Venue confirmed. Waiting on the broadcast schedule." },
          { eventId: event.id, authorId: marco.id, body: "Broadcast schedule came through — national window." },
          { eventId: event.id, authorId: priya.id, body: "Pricing looks soft midweek, worth a second look." },
        ],
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* C1 events, at various stages                                            */
  /* ---------------------------------------------------------------------- */

  const c1Specs = [
    { date: addDays(today, 26), type: "NBA", away: "Golden State Warriors", home: "Miami Heat", venue: "Kaseya Center", assignee: dana.id, doneCount: 0, label: "fresh in C1, on D-21" },
    { date: addDays(today, 16), type: "NHL", away: "Toronto Maple Leafs", home: "Tampa Bay Lightning", venue: "Amalie Arena", assignee: marco.id, doneCount: 1, label: "one stage done" },
    { date: addDays(today, 9), type: "NFL", away: "Green Bay Packers", home: "Detroit Lions", venue: "Ford Field", assignee: priya.id, doneCount: 2, label: "two stages done" },
    { date: addDays(today, 4), type: "Concert", away: "Karol G", home: null, venue: "Poliedro de Caracas", assignee: null, doneCount: 3, label: "late stages, unassigned" },
  ];

  for (const spec of c1Specs) {
    const schedule = buildReviewSchedule(spec.date, today, config);

    const event = await prisma.event.create({
      data: {
        eventDate: dbDateFromPlainDate(spec.date),
        eventTypeId: typeByName.get(spec.type)!,
        awayTeam: spec.away,
        homeTeam: spec.home,
        venue: spec.venue,
        assigneeId: spec.assignee,
        status: "C1",
        completedAt: new Date(),
        completedById: morgan.id,
        promotedAt: new Date(),
        seatGeekCheckedAt: new Date(),
        seatGeekById: morgan.id,
        ticketDataChecked: true,
        ticketDataById: morgan.id,
        stages: {
          create: schedule.map((plan, index) => {
            // Stages already past at promotion are SKIPPED, never PENDING —
            // they were never actionable and counting them as outstanding work
            // would make reporting lie.
            if (plan.alreadyPast) {
              return {
                offsetDays: plan.offsetDays,
                reviewDue: dbDateFromPlainDate(plan.reviewDue),
                status: "SKIPPED" as const,
                assigneeId: spec.assignee,
              };
            }

            const done = index < spec.doneCount;
            return {
              offsetDays: plan.offsetDays,
              reviewDue: dbDateFromPlainDate(plan.reviewDue),
              status: done ? ("DONE" as const) : ("PENDING" as const),
              assigneeId: spec.assignee,
              ...(done
                ? { doneAt: new Date(), doneById: spec.assignee ?? morgan.id }
                : {}),
            };
          }),
        },
      },
    });

    console.log(`  C1        ${spec.date}  ${formatPlainDateWithWeekday(spec.date).padEnd(12)} ${spec.label}`);

    // A flagged C1 row too, so the filter chip has something to find.
    if (spec.type === "Concert") {
      await prisma.event.update({
        where: { id: event.id },
        data: {
          flaggedAt: new Date(),
          flaggedById: marco.id,
          flagReason: "Nobody assigned and the deadline is close.",
        },
      });
    }

    await prisma.eventNote.create({
      data: {
        eventId: event.id,
        authorId: morgan.id,
        body: "Moved to staging. Check inventory before the next checkpoint.",
      },
    });
  }

  /* ---------------------------------------------------------------------- */
  /* A fully completed event — the productivity history the Archive tab used  */
  /* to show, still queryable even though there is no longer a screen for it. */
  /* ---------------------------------------------------------------------- */

  const finishedDate = addDays(today, -14);
  const finishedSchedule = buildReviewSchedule(finishedDate, today, config);

  await prisma.event.create({
    data: {
      eventDate: dbDateFromPlainDate(finishedDate),
      eventTypeId: typeByName.get("NFL")!,
      awayTeam: "Philadelphia Eagles",
      homeTeam: "New York Giants",
      venue: "MetLife Stadium",
      assigneeId: jordan.id,
      status: "COMPLETED",
      completedAt: new Date(),
      completedById: morgan.id,
      promotedAt: new Date(),
      seatGeekCheckedAt: new Date(),
      seatGeekById: jordan.id,
      ticketDataChecked: true,
      ticketDataById: jordan.id,
      stages: {
        create: finishedSchedule.map((plan) => ({
          offsetDays: plan.offsetDays,
          reviewDue: dbDateFromPlainDate(plan.reviewDue),
          status: "DONE" as const,
          assigneeId: jordan.id,
          doneAt: new Date(),
          doneById: jordan.id,
        })),
      },
    },
  });

  console.log(`  finished  ${finishedDate}  all stages done, worked by a now-deactivated user`);

  const [dashboardCount, c1Count, stageCount, noteCount] = await Promise.all([
    prisma.event.count({ where: { status: "DASHBOARD" } }),
    prisma.event.count({ where: { status: "C1" } }),
    prisma.reviewStage.count(),
    prisma.eventNote.count(),
  ]);

  console.log("\nSeed complete");
  console.log(`  Event Dashboard: ${dashboardCount} event(s)`);
  console.log(`  C1 staging:      ${c1Count} event(s)`);
  console.log(`  Review stages:   ${stageCount}`);
  console.log(`  Notes:           ${noteCount}`);
  console.log(`\n  Admin    ${avery.email} / ${SEED_PASSWORD}`);
  console.log(`  Manager  ${morgan.email} / ${SEED_PASSWORD}`);
  console.log(`  User     ${dana.email} / ${SEED_PASSWORD}`);
}

/** The first occurrence of `weekday` on or after `from`. */
function findNextWeekday(from: PlainDate, weekday: Weekday): PlainDate {
  let cursor = from;
  for (let i = 0; i < 7; i += 1) {
    if (dayOfWeek(cursor) === weekday) return cursor;
    cursor = addDays(cursor, 1);
  }
  return from;
}

main()
  .catch((error) => {
    console.error("\nSeed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
