"use client";

import * as React from "react";

const MIN_WIDTH = 60;
const MAX_WIDTH = 800;

/**
 * Drag-to-resize table columns, remembered per table.
 *
 * Widths live in localStorage rather than on the user record: column sizing is
 * a property of the screen you are sitting at — a laptop and a wide monitor
 * want different layouts — so syncing it across machines would be actively
 * unhelpful.
 *
 * Only columns the user has actually dragged are stored. Everything else keeps
 * its designed width, so adding a column later does not invalidate anyone's
 * saved layout.
 */
export function useColumnWidths(tableKey: string) {
  const storageKey = `jpd-cols-${tableKey}`;
  const [widths, setWidths] = React.useState<Record<string, number>>({});
  const dragging = React.useRef<{ key: string; startX: number; startWidth: number } | null>(
    null,
  );

  // Loaded after mount, never during render: reading localStorage while
  // rendering would make the server and client markup disagree.
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setWidths(JSON.parse(raw) as Record<string, number>);
    } catch {
      // Corrupt or unavailable storage just means default widths.
    }
  }, [storageKey]);

  const persist = React.useCallback(
    (next: Record<string, number>) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Sizing still applies for this session.
      }
    },
    [storageKey],
  );

  const startResize = React.useCallback(
    (key: string, event: React.PointerEvent<HTMLElement>) => {
      // The handle sits inside a sortable header button; without this a resize
      // drag would also register as a click and re-sort the table.
      event.preventDefault();
      event.stopPropagation();

      const header = event.currentTarget.closest("th");
      if (!header) return;

      dragging.current = {
        key,
        startX: event.clientX,
        startWidth: header.getBoundingClientRect().width,
      };

      const onMove = (move: PointerEvent) => {
        const state = dragging.current;
        if (!state) return;
        const delta = move.clientX - state.startX;
        const width = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, state.startWidth + delta),
        );
        setWidths((current) => ({ ...current, [state.key]: width }));
      };

      const onUp = () => {
        dragging.current = null;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        // Persist from the latest state rather than a captured copy.
        setWidths((current) => {
          persist(current);
          return current;
        });
      };

      // Suppress text selection for the duration of the drag, which otherwise
      // highlights the whole table as the pointer moves.
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [persist],
  );

  const reset = React.useCallback(() => {
    setWidths({});
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Nothing to clean up.
    }
  }, [storageKey]);

  /** Inline style for a header cell, or `undefined` to keep its class width. */
  const widthStyle = React.useCallback(
    (key: string): React.CSSProperties | undefined => {
      const width = widths[key];
      return width ? { width, minWidth: width, maxWidth: width } : undefined;
    },
    [widths],
  );

  return {
    widthStyle,
    startResize,
    reset,
    hasCustomWidths: Object.keys(widths).length > 0,
  };
}

/** The drag handle rendered at the right edge of a resizable header. */
export function ResizeHandle({
  columnKey,
  onStart,
}: {
  columnKey: string;
  onStart: (key: string, event: React.PointerEvent<HTMLElement>) => void;
}) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      onPointerDown={(event) => onStart(columnKey, event)}
      onClick={(event) => event.stopPropagation()}
      className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize select-none opacity-0 transition hover:opacity-100"
      style={{ touchAction: "none" }}
    >
      <span
        aria-hidden
        className="absolute inset-y-1 right-[3px] w-px"
        style={{ background: "var(--accent)" }}
      />
    </span>
  );
}
