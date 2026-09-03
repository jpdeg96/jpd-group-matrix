"use client";

import * as React from "react";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/ui/cn";

export interface ColumnSpec {
  key: string;
  label: string;
  /**
   * The narrowest this column can get and still be readable, in pixels.
   *
   * A floor, not a preference — the `w-[…]` hint on each header is the
   * comfortable width, and the browser is free to squeeze past it. Summing the
   * comfortable widths instead would make the table *wider* than the fixed
   * min-width it replaced, which is the opposite of the point.
   *
   * Fifteen of these still will not fit a laptop; that is arithmetic, not a
   * bug. What it buys is that hiding a column now reclaims its width instead of
   * leaving the scrollbar exactly where it was.
   */
  width: number;
  /**
   * Columns without which a row cannot be identified. Not hideable: a table you
   * can no longer read is not a narrower table, it is a broken one.
   */
  required?: boolean;
}

/**
 * Which columns exist, in the order they appear.
 *
 * The widths here are the honest minimums rather than the comfortable ones. The
 * table is still resizable by hand; this only decides how much room the browser
 * must find before it gives up and scrolls.
 */
export const DASHBOARD_COLUMNS: readonly ColumnSpec[] = [
  { key: "date", label: "Date", width: 120, required: true },
  { key: "type", label: "Type", width: 90 },
  { key: "away", label: "Away Team / Artist", width: 140, required: true },
  { key: "home", label: "Home Team", width: 140 },
  { key: "venue", label: "Venue", width: 120 },
  { key: "progress", label: "In progress", width: 110 },
  { key: "assigned", label: "Assigned", width: 120 },
  { key: "flag", label: "Flag", width: 90 },
  { key: "complete", label: "Complete", width: 130 },
  { key: "seatgeek", label: "SeatGeek", width: 100 },
  { key: "ticketdata", label: "TicketData", width: 80 },
  { key: "sendtoc1", label: "To C1", width: 95 },
  { key: "notes", label: "Notes", width: 140 },
  { key: "audited", label: "Audited", width: 100 },
  { key: "actions", label: "Actions", width: 85 },
];

/** Labels match the headers exactly, so the picker names what it turns off. */
export const C1_COLUMNS: readonly ColumnSpec[] = [
  { key: "due", label: "Review Due", width: 120, required: true },
  { key: "stage", label: "Stage", width: 80, required: true },
  { key: "date", label: "Date", width: 152 },
  { key: "type", label: "Type", width: 104 },
  { key: "away", label: "Away Team / Artist", width: 184, required: true },
  { key: "home", label: "Home Team", width: 184 },
  { key: "venue", label: "Venue", width: 160 },
  { key: "notes", label: "Notes", width: 224 },
  { key: "progress", label: "In progress", width: 136 },
  { key: "assigned", label: "Assigned", width: 160 },
  { key: "flag", label: "Flag", width: 112 },
  { key: "done", label: "Done", width: 80, required: true },
];

/**
 * How wide the table needs to be for the columns actually on screen.
 *
 * Computed rather than fixed, which is the point: a hard `min-width` meant
 * turning a column off freed no space and the scrollbar stayed exactly where it
 * was. There is still a floor, because a table squeezed below it is unreadable
 * in a different way.
 */
export function tableMinWidth(
  columns: readonly ColumnSpec[],
  hidden: ReadonlySet<string>,
  extra = 0,
): number {
  const total = columns
    .filter((column) => !hidden.has(column.key))
    .reduce((sum, column) => sum + column.width, extra);

  return Math.max(total, 640);
}

/**
 * Turns columns on and off.
 *
 * Fifteen columns of this kind of content genuinely cannot fit a laptop, so the
 * choice is between a horizontal scrollbar for everyone and letting people drop
 * what they do not use. Everything starts visible: narrowing the table should
 * be a decision somebody makes while looking at what it costs, not a default
 * that quietly hides data they were relying on.
 */
export function ColumnPicker({
  columns,
  hidden,
  onChange,
}: {
  columns: readonly ColumnSpec[];
  hidden: ReadonlySet<string>;
  onChange: (hidden: string[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  /**
   * Where the menu goes, and how tall it may be.
   *
   * This control lives in the table footer, which is at the bottom of a long
   * page — so a menu that always opens downward opens straight off the screen,
   * with no way to reach the columns at the end of the list. It flips above the
   * button when there is more room there, and is capped to whatever room it
   * actually has so the list scrolls instead of overflowing.
   */
  const [placement, setPlacement] = React.useState<{ up: boolean; maxHeight: number }>({
    up: false,
    maxHeight: 320,
  });

  const place = React.useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const box = button.getBoundingClientRect();
    // 8px of breathing room, so the menu never sits flush against the edge.
    const below = window.innerHeight - box.bottom - 8;
    const above = box.top - 8;
    const up = below < 260 && above > below;

    setPlacement({ up, maxHeight: Math.max(160, Math.floor(up ? above : below)) });
  }, []);

  React.useEffect(() => {
    if (!open) return;

    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Scrolling or resizing while it is open moves the button, and the menu has
    // to follow rather than stay where it was told to go.
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const hiddenCount = columns.filter(
    (column) => !column.required && hidden.has(column.key),
  ).length;

  function toggle(key: string) {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange([...next]);
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        ref={buttonRef}
        size="sm"
        variant={hiddenCount > 0 ? "primary" : "secondary"}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          // Measured before opening, so the first paint is already in the
          // right place rather than jumping after it appears.
          if (!open) place();
          setOpen((value) => !value);
        }}
        title="Choose which columns to show"
      >
        Columns
        {hiddenCount > 0 ? (
          <span className="tabular-nums">−{hiddenCount}</span>
        ) : null}
      </Button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute right-0 z-50 w-56 overflow-y-auto rounded-md border p-1 shadow-xl scrollbar-thin",
            placement.up ? "bottom-full mb-1" : "top-full mt-1",
          )}
          style={{
            background: "var(--surface-raised)",
            borderColor: "var(--line-strong)",
            maxHeight: placement.maxHeight,
          }}
        >
          <p className="px-2 py-1.5 text-[11px]" style={{ color: "var(--ink-subtle)" }}>
            Hide what you do not use to fit a narrower screen. Remembered on this
            machine.
          </p>

          {columns.map((column) => {
            const shown = !hidden.has(column.key);

            return (
              <label
                key={column.key}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[12px] transition hover:brightness-95"
                style={{ opacity: column.required ? 0.55 : 1 }}
                title={
                  column.required
                    ? "Always shown — a row cannot be identified without it."
                    : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={shown}
                  disabled={column.required}
                  onChange={() => toggle(column.key)}
                  style={{ accentColor: "var(--accent)" }}
                  className="h-3.5 w-3.5"
                />
                {column.label}
              </label>
            );
          })}

          {hiddenCount > 0 ? (
            <div className="border-t p-1 pt-1.5" style={{ borderColor: "var(--line)" }}>
              <Button size="sm" variant="ghost" onClick={() => onChange([])}>
                Show every column
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
