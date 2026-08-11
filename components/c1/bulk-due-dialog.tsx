"use client";

import * as React from "react";
import { Button, Dialog, Field, Input } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import { isPlainDate, type PlainDate } from "@/lib/date/plain-date";
import { cn } from "@/lib/ui/cn";

type Mode = "SET" | "SHIFT";

/**
 * Bulk review-date edit.
 *
 * Two modes because they answer different questions. "Set to" is for a fixed
 * deadline everything must hit; "Shift by" moves a whole run without collapsing
 * the spacing between stages — which is what you almost always want when a
 * schedule slips.
 */
export function BulkDueDialog({
  open,
  stageIds,
  today,
  onClose,
  onApplied,
}: {
  open: boolean;
  stageIds: string[];
  today: PlainDate;
  onClose: () => void;
  onApplied: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = React.useState<Mode>("SET");
  const [date, setDate] = React.useState<string>(today);
  const [shift, setShift] = React.useState<number>(7);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setMode("SET");
      setDate(today);
      setShift(7);
    }
  }, [open, today]);

  const valid = mode === "SET" ? isPlainDate(date) : Number.isInteger(shift) && shift !== 0;

  async function apply() {
    setPending(true);
    try {
      const result = await api.patch<{ updated: number; skipped: number }>(
        "/api/stages/bulk",
        mode === "SET"
          ? { stageIds, reviewDue: date }
          : { stageIds, shiftDays: shift },
      );

      toast.success(
        `Updated ${result.updated} review date${result.updated === 1 ? "" : "s"}` +
          (result.skipped > 0 ? `, skipped ${result.skipped} already resolved.` : "."),
      );
      onApplied();
    } catch (error) {
      toast.error(
        "Could not update the review dates.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Edit ${stageIds.length} review date${stageIds.length === 1 ? "" : "s"}`}
      description="Applies to the current stage of each selected event. Already-resolved stages are skipped."
      width="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} disabled={!valid} onClick={apply}>
            Apply
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div
          role="radiogroup"
          aria-label="Edit mode"
          className="inline-flex rounded-md border p-0.5"
          style={{ borderColor: "var(--line-strong)", background: "var(--canvas)" }}
        >
          {(["SET", "SHIFT"] as Mode[]).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "rounded px-3 py-1 text-[12px] font-medium transition",
              )}
              style={{
                background: mode === value ? "var(--accent)" : "transparent",
                color: mode === value ? "var(--accent-contrast)" : "var(--ink-muted)",
              }}
            >
              {value === "SET" ? "Set to a date" : "Shift by days"}
            </button>
          ))}
        </div>

        {mode === "SET" ? (
          <Field
            label="New review due date"
            htmlFor="bulkDate"
            hint="Every selected row moves to this exact date."
          >
            <Input
              id="bulkDate"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
        ) : (
          <Field
            label="Shift by (days)"
            htmlFor="bulkShift"
            hint="Negative moves earlier. Spacing between rows is preserved."
          >
            <Input
              id="bulkShift"
              type="number"
              min={-365}
              max={365}
              value={shift}
              onChange={(event) => setShift(Number(event.target.value))}
            />
          </Field>
        )}

        <p className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
          Dates set this way are marked manual, so nothing recalculates over them
          later.
        </p>
      </div>
    </Dialog>
  );
}
