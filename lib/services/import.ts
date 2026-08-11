/**
 * Bulk import execution.
 *
 * Two steps by design: `previewImport` parses and validates without writing
 * anything, and `commitImport` writes only the rows the user has seen. A blind
 * import of two hundred rows containing one bad date is how you end up
 * hand-deleting records.
 */

import { prisma } from "@/lib/db/prisma";
import { dbDateFromPlainDate } from "@/lib/date/plain-date";
import {
  markDuplicates,
  parseImport,
  type ParsedRow,
  type ParseResult,
} from "@/lib/domain/import-parse";
import { validationError } from "@/lib/errors";
import { auditActor, type ActorContext } from "@/lib/auth/actor";
import { listActiveEventTypes, resolveOrCreateEventType } from "./event-types";
import { recordAudit } from "./audit";

/** Hard ceiling per import, so one paste cannot lock the table for minutes. */
const MAX_IMPORT_ROWS = 1000;

export async function previewImport(text: string): Promise<ParseResult> {
  const [types, users] = await Promise.all([
    listActiveEventTypes(),
    prisma.user.findMany({ where: { active: true }, select: { displayName: true } }),
  ]);

  const result = parseImport(text, {
    knownTypes: types.map((type) => type.name),
    knownUsers: users.map((user) => user.displayName),
  });

  if (result.rows.length > MAX_IMPORT_ROWS) {
    throw validationError(
      `That is ${result.rows.length} rows. Please import at most ${MAX_IMPORT_ROWS} at a time.`,
    );
  }

  return { ...result, rows: markDuplicates(result.rows) };
}

export interface ImportOutcome {
  created: number;
  skipped: number;
  typesCreated: string[];
}

/**
 * Writes the valid rows.
 *
 * Rows carrying errors are skipped rather than failing the whole batch — the
 * user has already seen exactly which ones in the preview, and rejecting 199
 * good rows because of one bad one helps nobody.
 *
 * The whole batch is one transaction, so an unexpected failure leaves nothing
 * half-imported.
 */
export async function commitImport(
  text: string,
  actor: ActorContext,
): Promise<ImportOutcome> {
  const preview = await previewImport(text);
  const importable = preview.rows.filter((row) => row.errors.length === 0);

  if (importable.length === 0) {
    throw validationError("No valid rows to import.");
  }

  const typesCreated: string[] = [];

  // Types are resolved up front, outside the write transaction: creating one
  // is itself a write, and doing it inline would make the transaction depend on
  // its own uncommitted rows.
  const typeIds = new Map<string, string>();
  for (const row of importable) {
    const key = row.type.toLowerCase();
    if (typeIds.has(key)) continue;

    const { id, created } = await resolveOrCreateEventType(row.type, actor.real.id);
    typeIds.set(key, id);
    if (created) typesCreated.push(row.type);
  }

  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, displayName: true },
  });
  const userIds = new Map(
    users.map((user) => [user.displayName.toLowerCase(), user.id]),
  );

  const created = await prisma.$transaction(async (tx) => {
    const result = await tx.event.createMany({
      data: importable.map((row: ParsedRow) => ({
        eventDate: dbDateFromPlainDate(row.eventDate!),
        eventTypeId: typeIds.get(row.type.toLowerCase())!,
        awayTeam: row.awayTeam,
        homeTeam: row.homeTeam,
        venue: row.venue,
        // An unrecognised name was already flagged in the preview; the row is
        // imported unassigned rather than dropped.
        assigneeId: row.assignee
          ? (userIds.get(row.assignee.toLowerCase()) ?? null)
          : null,
        status: "DASHBOARD" as const,
      })),
    });

    return result.count;
  });

  await recordAudit({
    ...auditActor(actor),
    entityType: "EVENT",
    entityId: "00000000-0000-0000-0000-000000000000",
    action: "BULK_IMPORT",
    newValue: {
      created,
      skipped: preview.errorCount,
      typesCreated,
    },
  });

  return { created, skipped: preview.errorCount, typesCreated };
}
