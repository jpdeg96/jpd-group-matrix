"use client";

import * as React from "react";

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/**
 * Donut for part-to-whole.
 *
 * Kept to six segments; anything past that folds into "Other" upstream rather
 * than growing new hues, which under colour-vision deficiency would be
 * indistinguishable from an existing slice.
 *
 * A donut answers "roughly what share?" at a glance and is poor at comparing
 * close values, so the legend carries the exact count and percentage for every
 * slice — that is also what satisfies the relief rule, since three of the six
 * slots sit below 3:1 contrast on a near-white surface.
 *
 * A 2px surface-coloured gap separates neighbouring segments instead of a
 * stroke around each one.
 */
export function DonutChart({
  slices,
  size = 168,
  thickness = 26,
  centerLabel,
  centerValue,
}: {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [pointer, setPointer] = React.useState<{ x: number; y: number } | null>(null);
  const frameRef = React.useRef<HTMLDivElement | null>(null);

  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  if (total === 0) {
    return (
      <p className="px-1 py-6 text-center text-[12px]" style={{ color: "var(--ink-subtle)" }}>
        Nothing recorded in this period.
      </p>
    );
  }

  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  // 2px of surface between segments, expressed in stroke-dash units.
  const gap = 2;

  let offset = 0;

  const hoveredSlice = slices.find((slice) => slice.key === hovered) ?? null;

  function track(event: React.MouseEvent) {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return;
    setPointer({ x: event.clientX - box.left, y: event.clientY - box.top });
  }

  function leave() {
    setHovered(null);
    setPointer(null);
  }

  return (
    <div ref={frameRef} className="relative flex flex-wrap items-center gap-5">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Split by type: ${slices
          .map((s) => `${s.label} ${Math.round((s.value / total) * 100)}%`)
          .join(", ")}`}
        className="shrink-0"
      >
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {slices.map((slice) => {
            const fraction = slice.value / total;
            const length = Math.max(fraction * circumference - gap, 0.5);
            const dash = `${length} ${circumference - length}`;
            const thisOffset = offset;
            offset += fraction * circumference;
            const active = hovered === slice.key;

            return (
              <circle
                key={slice.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth={active ? thickness + 4 : thickness}
                strokeDasharray={dash}
                strokeDashoffset={-thisOffset}
                onMouseEnter={(event) => {
                  setHovered(slice.key);
                  track(event);
                }}
                onMouseMove={track}
                onMouseLeave={leave}
                style={{ transition: "stroke-width 120ms", cursor: "default" }}
              />
            );
          })}
        </g>

        {centerValue ? (
          <>
            <text
              x="50%"
              y="47%"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ fill: "var(--ink)", fontSize: 22, fontWeight: 600 }}
            >
              {centerValue}
            </text>
            <text
              x="50%"
              y="62%"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ fill: "var(--ink-subtle)", fontSize: 10 }}
            >
              {centerLabel}
            </text>
          </>
        ) : null}
      </svg>

      {/* Legend carries the exact numbers — the donut alone cannot be read
          precisely, and colour must never be the only channel. */}
      <ul className="min-w-[9rem] flex-1 space-y-1">
        {slices.map((slice) => (
          <li
            key={slice.key}
            className="flex items-center justify-between gap-3 text-[11.5px]"
            onMouseEnter={(event) => {
              setHovered(slice.key);
              track(event);
            }}
            onMouseMove={track}
            onMouseLeave={leave}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ background: slice.color }}
              />
              <span className="truncate" style={{ color: "var(--ink-muted)" }}>
                {slice.label}
              </span>
            </span>
            {/* A separator, not just a margin: "2" beside "40%" reads as the
                single number 240 when only whitespace divides them. */}
            <span className="shrink-0 tabular-nums" style={{ color: "var(--ink)" }}>
              {slice.value}
              <span aria-hidden className="mx-1 opacity-40">
                ·
              </span>
              <span className="opacity-60">
                {Math.round((slice.value / total) * 100)}%
              </span>
            </span>
          </li>
        ))}
      </ul>

      {/* An HTML tooltip rather than an SVG <title>: React treats <title> as
          hoistable document metadata even inside <svg>, and server-renders it
          empty when it has more than a single string child — which mismatches
          the client and makes React throw away the whole hydrated tree. */}
      {hoveredSlice && pointer ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border px-2 py-1 text-[11.5px] shadow-sm"
          style={{
            left: pointer.x + 12,
            top: pointer.y + 12,
            borderColor: "var(--line-strong)",
            background: "var(--surface)",
            color: "var(--ink)",
          }}
        >
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
              style={{ background: hoveredSlice.color }}
            />
            {hoveredSlice.label}
            {/* Same reason as the legend: a label ending in a digit would run
                straight into the count with only whitespace between them. */}
            <span aria-hidden className="opacity-40">
              ·
            </span>
            <span className="tabular-nums" style={{ color: "var(--ink-muted)" }}>
              {hoveredSlice.value} · {Math.round((hoveredSlice.value / total) * 100)}%
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
