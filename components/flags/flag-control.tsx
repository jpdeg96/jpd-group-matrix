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
  canResolve,
  onChanged,
}: {
  eventId: string;
  flaggedAt: string | null;
  flaggedByName: string | null;
  flagReason: string | null;
  canResolve: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const flagged = flaggedAt !== null;

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

  async function clear() {
    setPending(true);
    try {
      await api.delete(`/api/events/${eventId}/flag`);
      toast.success("Flag cleared.");
      onChanged();
    } catch (error) {
      toast.error(
        "Could not clear the flag.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  if (flagged) {
    return (
      <div className="flex flex-col items-start gap-1">
        <span
          className="inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-semibold"
          style={{ background: "var(--danger-soft)", color: "var(--danger)" }}
          title={
            [
              flaggedByName ? `Raised by ${flaggedByName}` : null,
              flaggedAt ? formatBusinessTimestamp(flaggedAt) : null,
              flagReason,
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          }
        >
          ⚑ Flagged
        </span>

        {flagReason ? (
          <span
            className="line-clamp-2 text-[10.5px]"
            style={{ color: "var(--ink-muted)" }}
          >
            {flagReason}
          </span>
        ) : null}

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
        ) : (
          <span className="text-[10px]" style={{ color: "var(--ink-subtle)" }}>
            manager to clear
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        title="Ask a manager or administrator to look at this event"
        className="rounded border px-1.5 py-0.5 text-[11px] transition hover:brightness-95"
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
