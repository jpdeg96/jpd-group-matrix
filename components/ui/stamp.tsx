"use client";

import { formatBusinessTimestamp, formatBusinessTimestampShort } from "@/lib/date/business-time";
import { cn } from "@/lib/ui/cn";

/**
 * A timestamp with a colored dot identifying who set it.
 *
 * The dot is a fast recognition cue when scanning a column of checkboxes — you
 * can see at a glance that three rows were done by the same person. It is never
 * the only cue: the name is in the tooltip and the whole thing has a text
 * fallback, so it degrades to plain information rather than to nothing.
 */
export function Stamp({
  at,
  byName,
  byColor,
  className,
}: {
  at: string | null;
  byName: string | null;
  byColor: string | null;
  className?: string;
}) {
  if (!at) {
    // A placeholder rather than nothing, and deliberately the same markup with
    // `invisible` — visibility:hidden still occupies its space.
    //
    // Returning null made the cell shorter, so ticking a checkbox grew its row
    // and shunted every row beneath it down the page. Mid-scan that reads as
    // the list jumping under you, and it is easy to tick the wrong row next.
    // Matching the real markup means the reserved height is right by
    // construction rather than by a guessed pixel value that drifts the moment
    // the font size changes.
    return (
      <span
        aria-hidden
        className={cn("invisible flex items-center gap-1 whitespace-nowrap", className)}
      >
        <span className="h-2 w-2 shrink-0 rounded-full" />
        <span className="text-[10.5px]">—</span>
      </span>
    );
  }

  return (
    <span
      className={cn("flex items-center gap-1 whitespace-nowrap", className)}
      title={
        byName
          ? `${byName} · ${formatBusinessTimestamp(at)}`
          : formatBusinessTimestamp(at)
      }
    >
      {byColor ? (
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full ring-1"
          style={{
            background: byColor,
            // A hairline ring keeps a pale dot visible on a pale surface and a
            // dark one visible in dark mode.
            // @ts-expect-error -- CSS custom property for the ring color.
            "--tw-ring-color": "color-mix(in oklch, var(--ink) 25%, transparent)",
          }}
        />
      ) : null}
      <span className="text-[10.5px]" style={{ color: "var(--ink-subtle)" }}>
        {formatBusinessTimestampShort(at)}
      </span>
      {byName ? <span className="sr-only">by {byName}</span> : null}
    </span>
  );
}
