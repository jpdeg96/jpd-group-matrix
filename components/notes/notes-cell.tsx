"use client";

import * as React from "react";
import { Button, Dialog, Textarea, UserChip } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import { formatBusinessTimestamp } from "@/lib/date/business-time";

export interface NoteView {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string;
  authorColor: string;
  createdAt: string;
  editedAt: string | null;
}

/**
 * Notes cell.
 *
 * Notes are a thread, not a text field. Several people leave notes on the same
 * event, so each entry shows its author and time — which is exactly what was
 * impossible when they shared one cell.
 *
 * The cell shows the latest note inline and opens the full thread on click.
 */
export function NotesCell({
  eventId,
  noteCount,
  latest,
  currentUserId,
  isAdmin,
  canWrite,
  mentionable,
  onCountChange,
  onLatestChange,
}: {
  eventId: string;
  noteCount: number;
  latest: NoteView | null;
  currentUserId: string;
  isAdmin: boolean;
  /**
   * Whether this person may add to the thread. Reading is never restricted —
   * the notes are how anybody understands what happened to a row, and hiding
   * them from everyone but the assignee would defeat the point of writing them.
   */
  canWrite: boolean;
  /** Everyone who can be @mentioned, for the picker. */
  mentionable: Array<{ id: string; displayName: string; color: string }>;
  onCountChange: (eventId: string, delta: number) => void;
  /**
   * Reports the newest note back to the row so the cell updates the moment a
   * note is saved, rather than after a page refresh.
   */
  onLatestChange: (eventId: string, note: NoteView | null) => void;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded border border-transparent px-1.5 py-1 text-left text-[12px] transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-raised)]"
        title={
          noteCount > 0
            ? "Open notes"
            : canWrite
              ? "Add a note"
              : "Read the notes. Only whoever holds this event can add one."
        }
      >
        {latest ? (
          <span className="block">
            <span className="flex items-center gap-1">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: latest.authorColor }}
              />
              <span
                className="truncate text-[10.5px] font-medium"
                style={{ color: "var(--ink-subtle)" }}
              >
                {latest.authorName}
                {noteCount > 1 ? ` +${noteCount - 1} more` : ""}
              </span>
            </span>
            <span className="line-clamp-2 whitespace-pre-wrap">{latest.body}</span>
          </span>
        ) : (
          <span style={{ color: "var(--ink-subtle)" }}>
            {canWrite ? "Add note…" : "No notes"}
          </span>
        )}
      </button>

      {open ? (
        <NotesDialog
          eventId={eventId}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          canWrite={canWrite}
          mentionable={mentionable}
          onClose={() => setOpen(false)}
          onCountChange={onCountChange}
          onLatestChange={onLatestChange}
        />
      ) : null}
    </>
  );
}

function NotesDialog({
  eventId,
  currentUserId,
  isAdmin,
  canWrite,
  mentionable,
  onClose,
  onCountChange,
  onLatestChange,
}: {
  eventId: string;
  currentUserId: string;
  isAdmin: boolean;
  canWrite: boolean;
  mentionable: Array<{ id: string; displayName: string; color: string }>;
  onClose: () => void;
  onCountChange: (eventId: string, delta: number) => void;
  onLatestChange: (eventId: string, note: NoteView | null) => void;
}) {
  const toast = useToast();
  const [notes, setNotes] = React.useState<NoteView[] | null>(null);
  const [draft, setDraft] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editDraft, setEditDraft] = React.useState("");

  const composer = React.useRef<HTMLTextAreaElement>(null);
  /** The partial name after an unfinished `@`, or null when not mentioning. */
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null);

  /*
   * Mentions need a picker, not just parsing.
   *
   * Names are matched server-side against the real list of people, so a
   * misspelled "@dana whitfeld" silently notifies nobody — it just sits in the
   * note looking like it worked. Offering the names removes the class of
   * failure rather than reporting it.
   */
  const suggestions = React.useMemo(() => {
    if (mentionQuery === null) return [];
    const needle = mentionQuery.toLowerCase();
    return mentionable
      .filter((user) => user.displayName.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [mentionQuery, mentionable]);

  /** Reads the `@…` the caret currently sits inside, if any. */
  function updateMentionQuery(value: string, caret: number) {
    const upToCaret = value.slice(0, caret);
    const at = upToCaret.lastIndexOf("@");

    if (at === -1) {
      setMentionQuery(null);
      return;
    }

    // Only when the @ starts a word, and only while the fragment after it is
    // still short enough to be a partial name rather than a paragraph.
    const before = upToCaret[at - 1];
    const fragment = upToCaret.slice(at + 1);

    if ((before !== undefined && !/\s/.test(before)) || fragment.length > 40) {
      setMentionQuery(null);
      return;
    }

    setMentionQuery(fragment);
  }

  function insertMention(displayName: string) {
    const element = composer.current;
    if (!element) return;

    const caret = element.selectionStart ?? draft.length;
    const at = draft.slice(0, caret).lastIndexOf("@");
    if (at === -1) return;

    const next = `${draft.slice(0, at)}@${displayName} ${draft.slice(caret)}`;
    setDraft(next);
    setMentionQuery(null);

    // Put the caret after the inserted name rather than at the end, so typing
    // continues where they were.
    const position = at + displayName.length + 2;
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(position, position);
    });
  }

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ notes: NoteView[] }>(`/api/events/${eventId}/notes`)
      .then((data) => {
        if (!cancelled) setNotes(data.notes);
      })
      .catch((error) => {
        if (!cancelled) {
          setNotes([]);
          toast.error(
            "Could not load notes.",
            error instanceof ApiRequestError ? error.message : undefined,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, toast]);

  async function add() {
    const body = draft.trim();
    if (!body) return;

    setPending(true);
    try {
      const result = await api.post<{ note: NoteView }>(
        `/api/events/${eventId}/notes`,
        { body },
      );
      setNotes((current) => [result.note, ...(current ?? [])]);
      setDraft("");
      onCountChange(eventId, 1);
      // Notes load newest-first, so a new one is always the row's latest.
      onLatestChange(eventId, result.note);
    } catch (error) {
      toast.error(
        "Could not add note.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  async function saveEdit(noteId: string) {
    const body = editDraft.trim();
    if (!body) return;

    setPending(true);
    try {
      const result = await api.patch<{ note: NoteView }>(`/api/notes/${noteId}`, {
        body,
      });
      const next =
        notes?.map((note) => (note.id === noteId ? result.note : note)) ?? null;
      setNotes(next);
      setEditingId(null);
      // Only the newest note is shown in the row, so an edit to it must be
      // reflected there too.
      if (next && next[0]?.id === noteId) onLatestChange(eventId, result.note);
    } catch (error) {
      toast.error(
        "Could not save note.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  async function remove(noteId: string) {
    if (!window.confirm("Delete this note? This cannot be undone.")) return;

    setPending(true);
    try {
      await api.delete(`/api/notes/${noteId}`);
      const next = notes?.filter((note) => note.id !== noteId) ?? null;
      setNotes(next);
      onCountChange(eventId, -1);
      // Deleting the newest note promotes the one behind it into the row.
      onLatestChange(eventId, next?.[0] ?? null);
    } catch (error) {
      toast.error(
        "Could not delete note.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Notes"
      description="Each note keeps its own author and time, so it is always clear who said what."
      width="md"
      footer={
        <Button onClick={onClose} disabled={pending}>
          Close
        </Button>
      }
    >
      <div className="space-y-3">
        {canWrite ? (
          <div className="space-y-1.5">
            <div className="relative">
              <Textarea
                ref={composer}
                rows={3}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  updateMentionQuery(
                    event.target.value,
                    event.target.selectionStart ?? event.target.value.length,
                  );
                }}
                onBlur={() => {
                  // Deferred: a click on a suggestion blurs the box before the
                  // click lands, and closing immediately would eat it.
                  window.setTimeout(() => setMentionQuery(null), 150);
                }}
                placeholder="Add a note… type @ to mention somebody"
                onKeyDown={(event) => {
                  if (event.key === "Escape" && mentionQuery !== null) {
                    event.preventDefault();
                    setMentionQuery(null);
                    return;
                  }
                  // Ctrl/Cmd+Enter submits — the common shortcut for a
                  // multiline box.
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void add();
                  }
                }}
              />

              {suggestions.length > 0 ? (
                <div
                  className="absolute left-1 right-1 top-full z-10 mt-0.5 overflow-hidden rounded-md border shadow-lg"
                  style={{ background: "var(--surface-raised)", borderColor: "var(--line-strong)" }}
                >
                  {suggestions.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onMouseDown={(event) => {
                        // mousedown, not click: the textarea's blur would
                        // otherwise close the list first.
                        event.preventDefault();
                        insertMention(user.displayName);
                      }}
                      className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[12px] transition hover:brightness-95"
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: user.color }}
                      />
                      {user.displayName}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px]" style={{ color: "var(--ink-subtle)" }}>
                Ctrl/⌘ + Enter to post · @ to mention
              </span>
              <Button
                variant="primary"
                size="sm"
                loading={pending}
                disabled={!draft.trim()}
                onClick={add}
              >
                Add note
              </Button>
            </div>
          </div>
        ) : (
          <p
            className="rounded-md border px-2.5 py-2 text-[11.5px]"
            style={{ borderColor: "var(--line)", color: "var(--ink-subtle)" }}
          >
            Only whoever holds this event can add a note. Everything already
            written is below.
          </p>
        )}

        <div
          className="max-h-[45vh] space-y-2 overflow-y-auto scrollbar-thin border-t pt-3"
          style={{ borderColor: "var(--line)" }}
        >
          {notes === null ? (
            <p className="text-[12px]" style={{ color: "var(--ink-subtle)" }}>
              Loading…
            </p>
          ) : notes.length === 0 ? (
            <p className="text-[12px]" style={{ color: "var(--ink-subtle)" }}>
              No notes yet.
            </p>
          ) : (
            notes.map((note) => {
              const canEdit = note.authorId === currentUserId || isAdmin;
              const editing = editingId === note.id;

              return (
                <article
                  key={note.id}
                  className="rounded-md border px-2.5 py-2"
                  style={{ borderColor: "var(--line)", background: "var(--canvas)" }}
                >
                  <header className="mb-1 flex items-center justify-between gap-2">
                    <UserChip
                      name={note.authorName}
                      color={note.authorColor}
                      className="text-[11.5px] font-medium"
                    />
                    <span
                      className="text-[10.5px] whitespace-nowrap"
                      style={{ color: "var(--ink-subtle)" }}
                    >
                      {formatBusinessTimestamp(note.createdAt)}
                      {note.editedAt ? " · edited" : ""}
                    </span>
                  </header>

                  {editing ? (
                    <div className="space-y-1.5">
                      <Textarea
                        rows={3}
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          loading={pending}
                          onClick={() => saveEdit(note.id)}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap text-[12.5px]">{note.body}</p>
                      {canEdit ? (
                        <div className="mt-1 flex gap-2">
                          <button
                            type="button"
                            className="text-[11px] underline-offset-2 hover:underline"
                            style={{ color: "var(--ink-subtle)" }}
                            onClick={() => {
                              setEditingId(note.id);
                              setEditDraft(note.body);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="text-[11px] underline-offset-2 hover:underline"
                            style={{ color: "var(--danger)" }}
                            onClick={() => remove(note.id)}
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                </article>
              );
            })
          )}
        </div>
      </div>
    </Dialog>
  );
}
