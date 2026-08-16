/**
 * Event notes.
 *
 * Notes are append-only entries, each carrying its own author and timestamp,
 * rather than one shared text field. Several people routinely leave notes on
 * the same event, and a single field made it impossible to tell who wrote what.
 *
 * Editing is restricted to the author (or an administrator) and stamps
 * `editedAt`, so a note cannot be quietly rewritten under someone else's name.
 */

import { prisma } from "@/lib/db/prisma";
import { forbidden, notFound, validationError } from "@/lib/errors";
import { auditActor, type ActorContext } from "@/lib/auth/actor";
import { recordAudit } from "./audit";

export interface NoteView {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string;
  authorColor: string;
  createdAt: string;
  editedAt: string | null;
}

const MAX_NOTE_LENGTH = 4000;

/**
 * Who to credit when a note has no author row.
 *
 * Two different situations produce a null author and they must not read the
 * same. A deleted user leaves their notes behind — that is a *former user*. An
 * imported note never had an author at all, because the source spreadsheet did
 * not record one; calling that a former user invents a person.
 */
function authorLabel(
  displayName: string | undefined,
  legacySource: string | null,
): string {
  if (displayName) return displayName;
  return legacySource ? "Imported" : "Former user";
}

export async function listNotes(eventId: string): Promise<NoteView[]> {
  const notes = await prisma.eventNote.findMany({
    where: { eventId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      body: true,
      authorId: true,
      createdAt: true,
      editedAt: true,
      author: { select: { displayName: true, color: true } },
      event: { select: { legacySource: true } },
    },
  });

  return notes.map((note) => ({
    id: note.id,
    body: note.body,
    authorId: note.authorId,
    authorName: authorLabel(note.author?.displayName, note.event.legacySource),
    authorColor: note.author?.color ?? "#64748b",
    createdAt: note.createdAt.toISOString(),
    editedAt: note.editedAt?.toISOString() ?? null,
  }));
}

/** The most recent note per event, for the collapsed dashboard cell. */
export async function latestNotesByEvent(
  eventIds: string[],
): Promise<Map<string, NoteView>> {
  if (eventIds.length === 0) return new Map();

  const notes = await prisma.eventNote.findMany({
    where: { eventId: { in: eventIds } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      eventId: true,
      body: true,
      authorId: true,
      createdAt: true,
      editedAt: true,
      author: { select: { displayName: true, color: true } },
      event: { select: { legacySource: true } },
    },
  });

  const latest = new Map<string, NoteView>();
  for (const note of notes) {
    // Ordered newest-first, so the first sighting of an event is its latest.
    if (latest.has(note.eventId)) continue;
    latest.set(note.eventId, {
      id: note.id,
      body: note.body,
      authorId: note.authorId,
      authorName: authorLabel(note.author?.displayName, note.event.legacySource),
      authorColor: note.author?.color ?? "#64748b",
      createdAt: note.createdAt.toISOString(),
      editedAt: note.editedAt?.toISOString() ?? null,
    });
  }

  return latest;
}

export async function addNote(
  eventId: string,
  body: string,
  actor: ActorContext,
): Promise<NoteView> {
  const trimmed = body.trim();
  if (!trimmed) throw validationError("A note cannot be empty.");
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw validationError(`A note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });
  if (!event) throw notFound("That event no longer exists.");

  const note = await prisma.eventNote.create({
    data: {
      eventId,
      // Attributed to the effective user so an impersonated session reads
      // naturally; the audit log still records who really wrote it.
      authorId: actor.effective.id,
      body: trimmed,
    },
    select: {
      id: true,
      body: true,
      authorId: true,
      createdAt: true,
      editedAt: true,
      author: { select: { displayName: true, color: true } },
    },
  });

  await recordAudit({
    ...auditActor(actor),
    entityType: "EVENT_NOTE",
    entityId: note.id,
    action: "CREATED",
    newValue: { eventId, body: trimmed },
  });

  return {
    id: note.id,
    body: note.body,
    authorId: note.authorId,
    authorName: note.author?.displayName ?? "Former user",
    authorColor: note.author?.color ?? "#64748b",
    createdAt: note.createdAt.toISOString(),
    editedAt: null,
  };
}

export async function updateNote(
  noteId: string,
  body: string,
  actor: ActorContext,
): Promise<NoteView> {
  const existing = await prisma.eventNote.findUnique({
    where: { id: noteId },
    select: { id: true, authorId: true, body: true, eventId: true },
  });
  if (!existing) throw notFound("That note no longer exists.");

  if (existing.authorId !== actor.effective.id && actor.effective.role !== "ADMIN") {
    throw forbidden("You can only edit your own notes.");
  }

  const trimmed = body.trim();
  if (!trimmed) throw validationError("A note cannot be empty.");

  const note = await prisma.eventNote.update({
    where: { id: noteId },
    data: { body: trimmed, editedAt: new Date() },
    select: {
      id: true,
      body: true,
      authorId: true,
      createdAt: true,
      editedAt: true,
      author: { select: { displayName: true, color: true } },
    },
  });

  // The previous text lives on in the audit log, so an edit never erases what
  // was originally said.
  await recordAudit({
    ...auditActor(actor),
    entityType: "EVENT_NOTE",
    entityId: noteId,
    action: "UPDATED",
    oldValue: { body: existing.body },
    newValue: { body: trimmed },
  });

  return {
    id: note.id,
    body: note.body,
    authorId: note.authorId,
    authorName: note.author?.displayName ?? "Former user",
    authorColor: note.author?.color ?? "#64748b",
    createdAt: note.createdAt.toISOString(),
    editedAt: note.editedAt?.toISOString() ?? null,
  };
}

export async function deleteNote(noteId: string, actor: ActorContext): Promise<void> {
  const existing = await prisma.eventNote.findUnique({
    where: { id: noteId },
    select: { id: true, authorId: true, body: true, eventId: true },
  });
  if (!existing) throw notFound("That note no longer exists.");

  if (existing.authorId !== actor.effective.id && actor.effective.role !== "ADMIN") {
    throw forbidden("You can only delete your own notes.");
  }

  await prisma.eventNote.delete({ where: { id: noteId } });

  await recordAudit({
    ...auditActor(actor),
    entityType: "EVENT_NOTE",
    entityId: noteId,
    action: "DELETED",
    oldValue: { eventId: existing.eventId, body: existing.body },
  });
}
