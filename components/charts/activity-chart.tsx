"use client";

import * as React from "react";
import { formatPlainDate, type PlainDate } from "@/lib/date/plain-date";

export interface ActivityPoint {
  date: PlainDate;
  count: number;
}

/**
 * Completions per day — a single-series column chart.
 *
 * One series, so one hue and no legend: the card title names it. Columns rather
 * than a line because the values are daily counts with real zeroes, and a line
 * would imply a continuous quantity sampled between the points.
 *
 * Only the busiest day is direct-labelled. A number above every column is
 * unreadable at 30+ days; the rest is carried by hover and the table view.
 */
export function ActivityChart({
  points,
  color,
  height = 120,
}: {
  points: ActivityPoint[];
  color: string;
  height?: number;
}) {
  const [hovered, setHovered] = React.useState<number | null>(null);

  if (points.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-[12px]" style={{ color: "var(--ink-subtle)" }}>
        Pick a bounded period to see daily activity.
      </p>
    );
  }

  const max = Math.max(...points.map((p) => p.count), 1);
  const peakIndex = points.findIndex((p) => p.count === max && max > 0);

  // Label roughly six ticks regardless of range length, so a 90-day period does
  // not render 90 overlapping dates.
  const tickEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div>
      <div
        className="flex items-end gap-[2px]"
        style={{ height }}
        onMouseLeave={() => setHovered(null)}
      >
        {points.map((point, index) => {
          const pct = (point.count / max) * 100;
          const active = hovered === index;

          return (
            <div
              key={point.date}
              className="relative flex min-w-0 flex-1 items-end justify-center"
              style={{ height: "100%" }}
              onMouseEnter={() => setHovered(index)}
              title={`${formatPlainDate(point.date)}: ${point.count}`}
            >
              <span
                className="w-full rounded-t-[4px]"
                style={{
                  height: `${Math.max(pct, point.count > 0 ? 3 : 1)}%`,
                  background: point.count > 0 ? color : "var(--line)",
                  opacity: active ? 1 : 0.92,
                }}
              />
              {index === peakIndex && max > 0 ? (
                <span
                  className="absolute -top-[14px] text-[10px] font-semibold tabular-nums"
                  style={{ color: "var(--ink)" }}
                >
                  {point.count}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div
        className="mt-1.5 flex gap-[2px] text-[9.5px] tabular-nums"
        style={{ color: "var(--ink-subtle)" }}
      >
        {points.map((point, index) => (
          <span key={point.date} className="min-w-0 flex-1 text-center">
            {index % tickEvery === 0 ? point.date.slice(5) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
