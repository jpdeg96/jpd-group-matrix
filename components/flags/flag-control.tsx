"use client";

import * as React from "react";
import { Button, Dialog, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import { formatBusinessTimestamp } from "@/lib/date/business-time";

/**
 * Raise or clear a "needs manager review" flag.
 *
 * Anyone can raise one; only managers and administrators can clear it. That
 * asymmetry is the point — the person who spots a problem is often not the
 * person allowed to fix it, and a flag that its cause can silently dismiss is
 * not a flag.
 */
export function FlagControl({
  eventId,
  flaggedAt,
  flaggedByName,
  flagReason,
  flagFixedAt,
  flagFixedByName,
  canResolve,
  canWork,
  onChanged,
}: {
  eventId: string;
  flaggedAt: string | null;
  flaggedByName: string | null;
  flagReason: string | null;
  /** Set once whoever the flag was for says they have dealt with it. */
  flagFixedAt: string | null;
  flagFixedByName: string | null;
  canResolve: boolean;
  /** Whether this person may act on this row at all — assignee, or a manager. */
  canWork: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [fixOpen, setFixOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [fixNote, setFixNote] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const flagged = flaggedAt !== null;
  const fixed = flagFixedAt !== null;

  async function raise() {
    setPending(true);
    try {
      await api.post(`/api/events/${eventId}/flag`, { reason: reason.trim() || null });
      toast.success("Flagged for review.");
      setDialogOpen(false);
      setReason("");
      onChanged();
    } catch (error) {
      toast.error(
        "Could not raise the flag.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  /** "I have dealt with this" — hands it back to a manager to check. */
  async function markFixed(): Promise<boolean> {
    setPending(true);
    try {
      await api.post(`/api/events/${eventId}/flag/fixed`, {
        reason: fixNote.trim() || null,
      });
      toast.success("Marked as dealt with. A manager will check and clear it.");
      setFixOpen(false);
      setFixNote("");
      onChanged();
      return true;
    } catch (error) {
      toast.error(
        "Could not mark that as dealt with.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
      return false;
    } finally {
      setPending(false);
    }
  }

  /** Reports whether it worked, so the caller only dismisses on success. */
  async function clear(): Promise<boolean> {
    setPending(true);
    try {
      await api.delete(`/api/events/${eventId}/flag`);
      toast.success("Flag cleared.");
      onChanged();
      return true;
    } catch (error) {
      toast.error(
        "Could not clear the flag.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
      return false;
    } finally {
      setPending(false);
    }
  }

  if (flagged) {
    return (
      <div className="flex flex-col items-start gap-1">
        {/* The chip and the reason open the full text together. A reason long
            enough to matter is exactly the one the cell cannot show, and until
            this was clickable the only way to read it was a hover tooltip —
            unusable on a touch screen and gone the moment the pointer moves. */}
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          title="Open the flag"
          className="w-full rounded border border-transparent px-1 py-0.5 text-left transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-raised)]"
        >
          {/* Two states, not one. "Dealt with" still shows the flag raised —
              it is only closed when a manager says so — but it has to look
              different, or the person who fixed it has no way to tell their
              hand-back registered. */}
          <span
            className="inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-semibold"
            style={
              fixed
                ? { background: "var(--warn-soft)", color: "var(--warn)" }
                : { background: "var(--danger-soft)", color: "var(--danger)" }
            }
          >
            {fixed ? "⚑ Awaiting check" : "⚑ Flagged"}
          </span>

          {flagReason ? (
            <span
              className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[10.5px]"
              style={{ color: "var(--ink-muted)" }}
            >
              {flagReason}
            </span>
          ) : null}
        </button>

        {canResolve ? (
          <button
            type="button"
            onClick={clear}
            disabled={pending}
            className="text-[10.5px] underline-offset-2 hover:underline disabled:opacity-50"
            style={{ color: "var(--ink-subtle)" }}
          >
            {pending ? "Clearing…" : "Clear flag"}
          </button>
        ) : fixed ? (
          <span className="text-[10px]" style={{ color: "var(--ink-subtle)" }}>
            manager to confirm
          </span>
        ) : canWork ? (
          <button
            type="button"
            onClick={() => setFixOpen(true)}
            disabled={pending}
            className="text-[10.5px] underline-offset-2 hover:underline disabled:opacity-50"
            style={{ color: "var(--ink-subtle)" }}
          >
            Mark as dealt with
          </button>
        ) : (
          <span className="text-[10px]" style={{ color: "var(--ink-subtle)" }}>
            manager to clear
          </span>
        )}

        <Dialog
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
          title="Flagged for review"
          description={
            [
              flaggedByName ? `Raised by ${flaggedByName}` : "Raised",
              flaggedAt ? formatBusinessTimestamp(flaggedAt) : null,
            ]
              .filter(Boolean)
              .join(" · ")
          }
          width="sm"
          footer={
            <>
              <Button onClick={() => setDetailOpen(false)} disabled={pending}>
                Close
              </Button>
              {canResolve ? (
                <Button
                  variant="danger"
                  loading={pending}
                  onClick={async () => {
                    if (await clear()) setDetailOpen(false);
                  }}
                >
                  Clear flag
                </Button>
              ) : null}
            </>
          }
        >
          {flagReason ? (
            <p
              className="max-h-[45vh] overflow-y-auto scrollbar-thin whitespace-pre-wrap break-words text-[12.5px]"
            >
              {flagReason}
            </p>
          ) : (
            <p className="text-[12px]" style={{ color: "var(--ink-subtle)" }}>
              No reason was given.
            </p>
          )}
          {fixed ? (
            <p
              className="mt-2 rounded border px-2 py-1.5 text-[11.5px]"
              style={{ borderColor: "var(--warn)", background: "var(--warn-soft)", color: "var(--warn)" }}
            >
              {flagFixedByName ?? "Somebody"} marked this as dealt with
              {flagFixedAt ? ` on ${formatBusinessTimestamp(flagFixedAt)}` : ""}.
              It stays flagged until a manager checks and clears it.
            </p>
          ) : null}

          {!canResolve ? (
            <p className="mt-2 text-[11px]" style={{ color: "var(--ink-subtle)" }}>
              Only a manager or administrator can clear this.
              {canWork && !fixed
                ? " Mark it as dealt with once you have sorted it and they will be told."
                : ""}
            </p>
          ) : null}
        </Dialog>

        <Dialog
          open={fixOpen}
          onClose={() => setFixOpen(false)}
          title="Mark as dealt with"
          description="This tells the managers it is ready to check. The flag stays raised until one of them clears it."
          width="sm"
          footer={
            <>
              <Button onClick={() => setFixOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} onClick={markFixed}>
                Mark as dealt with
              </Button>
            </>
          }
        >
          <Textarea
            rows={3}
            value={fixNote}
            onChange={(event) => setFixNote(event.target.value)}
            placeholder="What did you do about it? (optional)"
            autoFocus
          />
          <p className="mt-1.5 text-[11px]" style={{ color: "var(--ink-subtle)" }}>
            Whatever you write here goes to the manager with the notification,
            which is usually what saves them opening the event to find out.
          </p>
        </Dialog>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        disabled={!canWork}
        title={
          canWork
            ? "Ask a manager or administrator to look at this event"
            : "You can only flag an event assigned to you."
        }
        className="rounded border px-1.5 py-0.5 text-[11px] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ borderColor: "var(--line-strong)", color: "var(--ink-subtle)" }}
      >
        ⚑ Flag
      </button>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Flag for review"
        description="This puts the event in front of a manager. Only a manager or administrator can clear it."
        width="sm"
        footer={
          <>
            <Button onClick={() => setDialogOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="danger" loading={pending} onClick={raise}>
              Raise flag
            </Button>
          </>
        }
      >
        <Textarea
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="What needs looking at? (optional)"
          autoFocus
        />
        <p className="mt-1.5 text-[11px]" style={{ color: "var(--ink-subtle)" }}>
          Optional — but a sentence here usually saves a conversation later.
        </p>
      </Dialog>
    </>
  );
}
