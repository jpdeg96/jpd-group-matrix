"use client";

import * as React from "react";
import { Dialog, Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import { formatBusinessTimestamp } from "@/lib/date/business-time";

interface HistoryEntry {
  id: string;
  at: string;
  checked: boolean;
  actorName: string;
  actorColor: string;
  impersonatedName: string | null;
}

/**
 * The Complete tick/untick history for one event.
 *
 * Only offered once there is something to show — a link on every row that opens
 * an empty panel is noise. Read from the audit log, so it is the same record a
 * manager sees on the Audit Log screen rather than a parallel one.
 */
export function CompletionHistory({
  eventId,
  label,
}: {
  eventId: string;
  label: string;
}) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [entries, setEntries] = React.useState<HistoryEntry[] | null>(null);

  React.useEffect(() => {
    if (!open) return;

    let cancelled = false;
    api
      .get<{ history: HistoryEntry[] }>(`/api/events/${eventId}/history`)
      .then((data) => {
        if (!cancelled) setEntries(data.history);
      })
      .catch((error) => {
        if (cancelled) return;
        setEntries([]);
        toast.error(
          "Could not load the completion history.",
          error instanceof ApiRequestError ? error.message : undefined,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [open, eventId, toast]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="See every time Complete was ticked or unticked"
        className="text-[10px] underline-offset-2 hover:underline"
        style={{ color: "var(--ink-subtle)" }}
      >
        history
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Completion history"
        description={label}
        width="sm"
        footer={<Button onClick={() => setOpen(false)}>Close</Button>}
      >
        {entries === null ? (
          <p className="text-[12px]" style={{ color: "var(--ink-subtle)" }}>
            Loading…
          </p>
        ) : entries.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--ink-subtle)" }}>
            No completion changes recorded yet.
          </p>
        ) : (
          <ol className="space-y-2">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start gap-2 rounded-md border px-2.5 py-2"
                style={{ borderColor: "var(--line)", background: "var(--canvas)" }}
              >
                <span
                  aria-hidden
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: entry.checked ? "var(--success)" : "var(--danger)",
                  }}
                />
                <span className="min-w-0">
                  <span className="block text-[12px] font-medium">
                    {entry.checked ? "Marked complete" : "Unmarked"}
                  </span>
                  <span
                    className="block text-[11px]"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    <span
                      aria-hidden
                      className="mr-1 inline-block h-2 w-2 rounded-full align-[-1px]"
                      style={{ background: entry.actorColor }}
                    />
                    {entry.actorName}
                    {entry.impersonatedName
                      ? ` (viewing as ${entry.impersonatedName})`
                      : ""}
                    {" · "}
                    {formatBusinessTimestamp(entry.at)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Dialog>
    </>
  );
}
