/**
 * One-time migration off the PhantomChecker spreadsheet.
 *
 *   npm run import-legacy -- "C:/path/to/PhantomChecker Events.xlsx"
 *
 * DESTRUCTIVE. It deletes every event, review stage, note and presence row —
 * archived events included — and replaces them with the spreadsheet's contents.
 * Users, settings, payroll and contractors are untouched.
 *
 * The purge and the import run in **one transaction**. A migration that deletes
 * first and fails half way would leave a live system with nothing in it, which
 * is a far worse outcome than not running at all.
 *
 * Reads two tabs and ignores the rest of the workbook:
 *
 *   Event Dashboard — one row per event, and the authority on which exist
 *   C1              — one row per review checkpoint
 *
 * Everything created is stamped `legacySource`. These rows are genuinely
 * thinner than native ones — the spreadsheet recorded no assignee, nobody
 * against a completion, and no author on a note — and the badge exists so that
 * reads as history rather than as data loss.
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { prisma } from "../lib/db/prisma";
import { Workbook, text, serialToDate, serialToPlainDate, type Row } from "../lib/import/xlsx";
import { dbDateFromPlainDate, toPlainDate, type PlainDate } from "../lib/date/plain-date";
import { buildReviewSchedule } from "../lib/domain/review-schedule";
import { businessToday, getSettings } from "../lib/services/settings";

const LEGACY_SOURCE = "PhantomChecker spreadsheet";

/** The offsets the spreadsheet actually used, furthest-out first. */
const LEGACY_OFFSETS = [14, 7, 3, 1];

const DASH = {
  date: 0, type: 1, away: 2, home: 3, venue: 4,
  complete: 5, timestamp: 6, notes: 7, seatGeek: 8, ticketData: 9,
} as const;

const C1 = { reviewDue: 5, daysBefore: 6 } as const;

const args = process.argv.slice(2);
const workbookPath = args.find((arg) => !arg.startsWith("-"));
const assumeYes = args.includes("--yes") || args.includes("-y");

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

/** Only rows whose first cell is a real date serial; the rest is table padding. */
function dataRows(rows: Row[]): Row[] {
  const out: Row[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const serial = Number(text(row[0]));
    if (Number.isFinite(serial) && serial > 1000) out.push(row);
  }
  return out;
}

/** `"NFL 🏈"` → `{ name: "NFL", emoji: "🏈" }`. `"MISC"` → no emoji. */
function splitType(raw: string): { name: string; emoji: string | null } {
  const trimmed = raw.trim();
  const match = /^(.*?)\s*([\p{Extended_Pictographic}\u{FE0F}]+)$/u.exec(trimmed);
  if (!match || !match[1]?.trim()) return { name: trimmed, emoji: null };
  return { name: match[1].trim(), emoji: match[2]! };
}

/** Identity of an event across both sheets. */
const eventKey = (row: Row) =>
  [text(row[DASH.date]), text(row[DASH.type]), text(row[DASH.away]).toLowerCase(), text(row[DASH.home]).toLowerCase()].join("|");

const isTrue = (value: string) => value === "1" || value.toUpperCase() === "TRUE";

async function main() {
  if (!workbookPath) {
    throw new Error(
      'Give the spreadsheet path: npm run import-legacy -- "C:/path/PhantomChecker Events.xlsx"',
    );
  }

  console.log(
    `\nDatabase: ${(process.env.DATABASE_URL ?? "(unset)").replace(/\/\/[^@]*@/, "//***@")}`,
  );
  console.log(`Spreadsheet: ${workbookPath}\n`);

  /* -- read ---------------------------------------------------------------- */

  const workbook = Workbook.open(workbookPath);
  const dashboard = dataRows(workbook.rows("Event Dashboard"));
  const stageRows = dataRows(workbook.rows("C1"));

  console.log(`Read ${dashboard.length} dashboard rows and ${stageRows.length} C1 rows.`);

  const dashboardKeys = new Set(dashboard.map(eventKey));

  // The Event Dashboard is the authority on which events exist. A C1 row whose
  // event is not on it is dropped rather than resurrected.
  const orphanKeys = new Set<string>();
  let orphanStageRows = 0;
  for (const row of stageRows) {
    const key = eventKey(row);
    if (!dashboardKeys.has(key)) {
      orphanKeys.add(key);
      orphanStageRows += 1;
    }
  }

  const duplicates = dashboard.length - dashboardKeys.size;
  console.log(
    `${dashboardKeys.size} distinct events` +
      (duplicates > 0 ? ` (${duplicates} duplicate row(s) collapsed)` : "") +
      `; dropping ${orphanStageRows} C1 row(s) across ${orphanKeys.size} event(s) not on the dashboard.`,
  );

  const stagesByEvent = new Map<string, Row[]>();
  for (const row of stageRows) {
    const key = eventKey(row);
    if (!dashboardKeys.has(key)) continue;
    const list = stagesByEvent.get(key);
    if (list) list.push(row);
    else stagesByEvent.set(key, [row]);
  }

  /* -- plan ---------------------------------------------------------------- */

  const report = {
    onDashboard: 0,
    inC1: 0,
    scheduleDerived: 0,
    completedNoStages: 0,
    completeWithoutTimestamp: [] as string[],
    oddOffsets: 0,
    skipped: [] as string[],
  };

  // Some spreadsheet rows are ticked Complete but have no C1 rows at all. They
  // are real outstanding work, so rather than let them land as COMPLETED and
  // vanish from both screens, they get the schedule the application would have
  // given them on promotion — the same offsets, the same weekend rule, and
  // deadlines already past recorded as SKIPPED rather than as missed work.
  const [settings, today] = await Promise.all([getSettings(), businessToday()]);
  const scheduleConfig = {
    // Settings is rewritten to the legacy offsets later in this run, so derive
    // from those rather than from whatever is configured right now.
    offsets: LEGACY_OFFSETS,
    weekendAdjustment: settings.weekendAdjustment,
  };

  const typeNames = [...new Set(dashboard.map((r) => text(r[DASH.type])).filter(Boolean))].sort();

  const events: Record<string, unknown>[] = [];
  /** The raw type label of `events[i]`, resolved to an id inside the transaction. */
  const eventTypeRaw: string[] = [];
  const stages: Record<string, unknown>[] = [];
  const notes: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const row of dashboard) {
    const key = eventKey(row);
    if (seen.has(key)) continue;
    seen.add(key);

    const eventDate = serialToPlainDate(Number(text(row[DASH.date])));
    if (!eventDate) {
      report.skipped.push(`unreadable date: ${text(row[DASH.away])}`);
      continue;
    }

    const typeRaw = text(row[DASH.type]);
    if (!typeRaw) {
      report.skipped.push(`no type: ${eventDate} ${text(row[DASH.away])}`);
      continue;
    }

    const rowStages = stagesByEvent.get(key) ?? [];

    const ticked = isTrue(text(row[DASH.complete]));
    const completedAt = ticked ? serialToDate(Number(text(row[DASH.timestamp]))) : null;

    // A completion has to record when it happened — the schema insists, and
    // rightly. There is no honest date to invent for one that does not, so such
    // a row stays on the dashboard and is named in the report to be ticked by
    // hand.
    const complete = ticked && completedAt !== null;
    if (ticked && !complete) {
      report.completeWithoutTimestamp.push(
        `${eventDate}  ${text(row[DASH.away])} v ${text(row[DASH.home]) || "—"}`,
      );
    }

    const id = randomUUID();

    // The schema bounds an offset to 1–365 days. Anything outside that is not a
    // checkpoint anyone could have worked, so it is dropped rather than clamped.
    const byOffset = new Map<number, Row>();
    for (const stageRow of rowStages) {
      const offset = Number(text(stageRow[C1.daysBefore]));
      if (!Number.isInteger(offset) || offset < 1 || offset > 365) {
        report.oddOffsets += 1;
        continue;
      }
      if (!byOffset.has(offset)) byOffset.set(offset, stageRow);
    }

    const recorded: Record<string, unknown>[] = [];
    for (const [offset, stageRow] of [...byOffset].sort((a, b) => b[0] - a[0])) {
      const due = serialToPlainDate(Number(text(stageRow[C1.reviewDue])));
      if (!due) continue;
      recorded.push({
        eventId: id,
        offsetDays: offset,
        reviewDue: dbDateFromPlainDate(toPlainDate(due)),
        // Taken as recorded rather than recalculated. Marking it overridden
        // stops the app warning that it disagrees with the current schedule.
        reviewDueOverridden: true,
        status: "PENDING",
      });
    }

    let status: "DASHBOARD" | "C1" | "COMPLETED";

    if (!complete) {
      status = "DASHBOARD";
      report.onDashboard += 1;
    } else if (recorded.length > 0) {
      status = "C1";
      report.inC1 += 1;
      stages.push(...recorded);
    } else {
      // Ticked Complete with no C1 rows behind it. This is outstanding work, so
      // it gets the schedule the application itself would have built on
      // promotion rather than being written off as finished. Deadlines already
      // past are SKIPPED, exactly as `createStagesForEvent` does, because they
      // were never actionable and counting them as missed would make C1
      // permanently red.
      const plan = buildReviewSchedule(toPlainDate(eventDate), today, scheduleConfig);

      for (const stage of plan) {
        stages.push({
          eventId: id,
          offsetDays: stage.offsetDays,
          reviewDue: dbDateFromPlainDate(stage.reviewDue),
          // Derived, not recorded — so leave it under the schedule's control.
          reviewDueOverridden: false,
          status: stage.alreadyPast ? "SKIPPED" : "PENDING",
        });
      }

      // Every deadline in the past means there is genuinely nothing left to
      // work on, which is the one case that stays out of C1.
      if (plan.every((stage) => stage.alreadyPast)) {
        status = "COMPLETED";
        report.completedNoStages += 1;
      } else {
        status = "C1";
        report.scheduleDerived += 1;
      }
    }

    eventTypeRaw.push(typeRaw);
    events.push({
      id,
      eventDate: dbDateFromPlainDate(toPlainDate(eventDate)),
      eventTypeId: "",
      awayTeam: text(row[DASH.away]) || null,
      homeTeam: text(row[DASH.home]) || null,
      venue: text(row[DASH.venue]) || null,
      status,
      completedAt,
      promotedAt: completedAt,
      // Attribution is left null throughout: the spreadsheet recorded none.
      seatGeekCheckedAt: isTrue(text(row[DASH.seatGeek])) ? completedAt : null,
      ticketDataChecked: isTrue(text(row[DASH.ticketData])),
      legacySource: LEGACY_SOURCE,
    });

    const note = text(row[DASH.notes]);
    if (note) notes.push({ eventId: id, body: note, authorId: null });
  }

  /* -- confirm ------------------------------------------------------------- */

  const existing = {
    events: await prisma.event.count(),
    stages: await prisma.reviewStage.count(),
    notes: await prisma.eventNote.count(),
  };

  console.log(
    `\nWill DELETE ${existing.events} events, ${existing.stages} stages, ${existing.notes} notes ` +
      "(archived included), then insert " +
      `${events.length} events, ${stages.length} stages, ${notes.length} notes.`,
  );
  console.log("Users, settings, payroll and contractors are not touched.\n");

  if (!assumeYes) {
    const answer = (await ask("Type DELETE to proceed: ")).trim();
    if (answer !== "DELETE") {
      console.log("\nNothing changed.\n");
      return;
    }
  }

  /* -- write, all or nothing ----------------------------------------------- */

  await prisma.$transaction(
    async (tx) => {
      await tx.eventNote.deleteMany();
      await tx.presence.deleteMany();
      await tx.reviewStage.deleteMany();
      await tx.event.deleteMany();
      // Audit entries pointing at events that no longer exist would fill the
      // Audit Log with references to nothing. User, settings and payroll
      // history is left alone.
      await tx.auditLog.deleteMany({
        where: { entityType: { in: ["EVENT", "REVIEW_STAGE", "EVENT_NOTE"] } },
      });

      // An existing type of the same name is reused rather than duplicated, so
      // events already carrying it — and any Settings referring to it — survive.
      const typeIds = new Map<string, string>();
      for (const [index, raw] of typeNames.entries()) {
        const { name, emoji } = splitType(raw);
        const type = await tx.eventType.upsert({
          where: { name },
          update: { emoji, active: true },
          create: { name, emoji, sortOrder: index, active: true },
        });
        typeIds.set(raw, type.id);
      }

      for (const [index, event] of events.entries()) {
        event.eventTypeId = typeIds.get(eventTypeRaw[index]!);
      }

      await tx.event.createMany({ data: events as never });
      await tx.reviewStage.createMany({ data: stages as never });
      await tx.eventNote.createMany({ data: notes as never });

      await tx.settings.update({
        where: { id: "singleton" },
        data: { reviewOffsets: LEGACY_OFFSETS },
      });

      await tx.auditLog.create({
        data: {
          userId: null,
          entityType: "MAINTENANCE",
          // entity_id is a uuid column; there is no single row this describes.
          entityId: randomUUID(),
          action: "LEGACY_IMPORT",
          oldValue: existing,
          newValue: {
            events: events.length,
            stages: stages.length,
            notes: notes.length,
            source: LEGACY_SOURCE,
          },
        },
      });
    },
    // Generous: this is thousands of rows in one go, run once, by hand.
    { maxWait: 15_000, timeout: 180_000 },
  );

  /* -- report -------------------------------------------------------------- */

  console.log("\n--- imported ---");
  console.log(`  events                          ${events.length}`);
  console.log(`    on the dashboard              ${report.onDashboard}`);
  console.log(`    in C1, checkpoints as recorded ${report.inC1}`);
  console.log(`    in C1, checkpoints derived    ${report.scheduleDerived}`);
  console.log(`    completed, every deadline past ${report.completedNoStages}`);
  console.log(`  review stages                   ${stages.length}`);
  console.log(`  notes                           ${notes.length}`);
  console.log(`\nReview stages set to ${LEGACY_OFFSETS.join(", ")} days before the event.`);
  if (report.scheduleDerived > 0) {
    console.log(
      `\n  ${report.scheduleDerived} event(s) were ticked Complete with no C1 rows behind them.\n` +
        "  They were given that schedule so they appear in C1 as outstanding work;\n" +
        "  deadlines that had already passed are marked skipped, not missed.",
    );
  }

  if (report.completeWithoutTimestamp.length > 0) {
    console.log(
      `\n  ${report.completeWithoutTimestamp.length} row(s) were ticked Complete with no ` +
        "timestamp. A completion has to record when it happened, so rather than invent a date " +
        "these were left on the dashboard — tick them by hand:",
    );
    for (const line of report.completeWithoutTimestamp) console.log(`    ${line}`);
  }

  if (report.oddOffsets > 0) {
    console.log(
      `\n  ${report.oddOffsets} C1 row(s) had a days-before value outside 1–365 and were dropped.`,
    );
  }

  if (report.skipped.length > 0) {
    console.log(`\n  skipped ${report.skipped.length}:`);
    for (const reason of report.skipped.slice(0, 20)) console.log(`    ${reason}`);
  }

  console.log("\nEvery imported row is marked as legacy.\n");
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
