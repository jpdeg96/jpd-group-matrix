"use client";

import * as React from "react";
import { cn } from "@/lib/ui/cn";

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Identity dot beside the label — not the bar colour. */
  dotColor?: string | null;
  /** Extra line under the value in the tooltip. */
  hint?: string;
}

/**
 * Horizontal bar chart, single series.
 *
 * One hue for every bar. Colouring bars darker-where-bigger would double-encode
 * length as lightness and burn the only free channel on information the bar
 * already shows — so magnitude lives in length alone.
 *
 * Horizontal because the categories are people's names: long labels read
 * straight rather than rotated.
 *
 * Values are direct-labelled at the bar end, which is also what satisfies the
 * relief rule for the light surface. The label moves outside the bar when the
 * bar is too short to hold it, rather than being clipped.
 */
export function BarChart({
  data,
  color,
  valueFormatter = (value) => String(value),
  emptyMessage = "Nothing recorded in this period.",
  barHeight = 22,
  gap = 10,
  onSelect,
  selectHint,
}: {
  data: BarDatum[];
  color: string;
  valueFormatter?: (value: number) => string;
  emptyMessage?: string;
  barHeight?: number;
  gap?: number;
  /**
   * Makes each bar open the rows behind it.
   *
   * A bar is already a statement about a specific set of records, so being able
   * to see that set is the obvious next question. Given this, the row becomes a
   * real button — focusable and keyboard-operable — rather than a div with a
   * click handler, which would be interactive to a mouse and inert to anything
   * else.
   */
  onSelect?: (datum: BarDatum) => void;
  /** Appended to the tooltip so the bar says it can be opened. */
  selectHint?: string;
}) {
  const [hovered, setHovered] = React.useState<string | null>(null);

  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return (
      <p className="px-1 py-6 text-center text-[12px]" style={{ color: "var(--ink-subtle)" }}>
        {emptyMessage}
      </p>
    );
  }

  const max = Math.max(...data.map((d) => d.value), 1);
  const labelWidth = 132;
  const valueWidth = 46;

  return (
    <div className="w-full">
      {data.map((datum) => {
        const pct = (datum.value / max) * 100;
        // Under ~18% the value would not fit inside the bar with padding, so it
        // sits just past the end instead of being cropped.
        const inside = pct > 18;
        const active = hovered === datum.key;

        const base = datum.hint
          ? `${datum.label}: ${valueFormatter(datum.value)} · ${datum.hint}`
          : `${datum.label}: ${valueFormatter(datum.value)}`;

        // A zero bar has nothing behind it, so it is not offered as a link.
        const openable = Boolean(onSelect) && datum.value > 0;

        return (
          <div
            key={datum.key}
            role={openable ? "button" : undefined}
            tabIndex={openable ? 0 : undefined}
            className={cn(
              "flex items-center rounded-sm",
              openable
                ? "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
                : "",
            )}
            style={{
              height: barHeight + gap,
              ...(openable ? { outlineColor: "var(--accent)" } : {}),
            }}
            onMouseEnter={() => setHovered(datum.key)}
            onMouseLeave={() => setHovered(null)}
            onClick={openable ? () => onSelect!(datum) : undefined}
            onKeyDown={
              openable
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect!(datum);
                    }
                  }
                : undefined
            }
            title={openable && selectHint ? `${base} — ${selectHint}` : base}
          >
            <span
              className="flex shrink-0 items-center gap-1.5 truncate pr-2 text-[11.5px]"
              style={{ width: labelWidth, color: "var(--ink-muted)" }}
            >
              {datum.dotColor ? (
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: datum.dotColor }}
                />
              ) : null}
              <span className="truncate">{datum.label}</span>
            </span>

            <span className="relative flex min-w-0 flex-1 items-center">
              <span
                className="rounded-r-[4px] transition-[width,filter]"
                style={{
                  width: `${Math.max(pct, datum.value > 0 ? 1.5 : 0)}%`,
                  height: barHeight,
                  background: color,
                  filter: active ? "brightness(1.12)" : undefined,
                }}
              />
              {/* Direct label: inside when it fits, just outside when it does
                  not. Never clipped. */}
              <span
                className={cn(
                  "absolute text-[11px] font-semibold tabular-nums",
                  inside ? "text-white" : "",
                )}
                style={{
                  left: inside ? `calc(${pct}% - ${valueWidth}px)` : `calc(${pct}% + 6px)`,
                  width: valueWidth,
                  textAlign: inside ? "right" : "left",
                  color: inside ? "#fff" : "var(--ink)",
                }}
              >
                {valueFormatter(datum.value)}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
