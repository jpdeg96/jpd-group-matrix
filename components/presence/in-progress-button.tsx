"use client";

import * as React from "react";
import { cn } from "@/lib/ui/cn";
import type { PresenceEntry } from "./use-presence";

/**
 * The IN PROGRESS control.
 *
 * Deliberately the loudest thing on the screen — everything else is restrained
 * so that this reads at a glance. It shows both states in one control: press it
 * to claim the row, and see at all times who else is on it.
 */
export function InProgressButton({
  eventId,
  working,
  others,
  pending,
  onToggle,
}: {
  eventId: string;
  working: boolean;
  others: PresenceEntry[];
  pending: boolean;
  onToggle: (eventId: string, working: boolean) => void;
}) {
  const someoneElse = others.length > 0;

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => onToggle(eventId, !working)}
        aria-pressed={working}
        title={
          working
            ? "You are marked as working on this. Click to stop."
            : "Mark yourself as working on this so your team can see it live."
        }
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition",
          "disabled:opacity-60",
        )}
        style={
          working
            ? {
                background: "var(--live)",
                borderColor: "transparent",
                color: "#04140b",
              }
            : {
                background: "transparent",
                borderColor: "var(--line-strong)",
                color: "var(--ink-subtle)",
              }
        }
      >
        <span
          aria-hidden
          className={cn("h-2 w-2 rounded-full", working && "jpd-live-dot")}
          style={{ background: working ? "#04140b" : "var(--ink-subtle)" }}
        />
        {working ? "In progress" : "Start"}
      </button>

      {someoneElse ? (
        <div className="flex flex-wrap items-center gap-1">
          {others.map((entry) => (
            <span
              key={entry.userId}
              title={`${entry.userName} started ${entry.minutesActive} minute(s) ago`}
              className="inline-flex items-center gap-1 rounded px-1 py-px text-[10.5px] font-medium"
              style={{ background: "var(--live-soft)", color: "var(--live)" }}
            >
              <span
                aria-hidden
                className="jpd-live-dot h-1.5 w-1.5 rounded-full"
                style={{ background: entry.userColor }}
              />
              {entry.userName}
              {entry.minutesActive > 0 ? ` · ${entry.minutesActive}m` : ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
