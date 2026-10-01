"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, EmptyState, PageHeader, UserChip } from "@/components/ui/primitives";
import { formatPlainDateWithWeekday } from "@/lib/date/plain-date";
import {
  formatElapsed,
  LONG_RUNNING_MINUTES,
  useTeamPresence,
  type TeamPresence,
} from "@/components/shell/use-team-presence";

/**
 * Who is working on what, as a screen of its own.
 *
 * The same live list as the header chip, grouped by person rather than left
 * flat. Flat is right for a dropdown you scan in two seconds; on a page, one
 * person with three events open is a fact about that person, and three
 * separate rows bury it.
 *
 * Within a person the oldest claim leads, and people are ordered by their own
 * oldest claim, so whoever has had something open longest is at the top — the
 * entry worth a second look is the one that has been sitting.
 */
export function TeamView() {
  const router = useRouter();
  const { entries, peopleCount } = useTeamPresence();

  const groups = React.useMemo(() => {
    const byUser = new Map<string, TeamPresence[]>();
    // `entries` arrives oldest claim first, so pushing in order keeps each
    // person's list in that order too.
    for (const entry of entries) {
      const list = byUser.get(entry.userId);
      if (list) list.push(entry);
      else byUser.set(entry.userId, [entry]);
    }
    return [...byUser.values()];
  }, [entries]);

  function jumpTo(entry: TeamPresence) {
    const screen = entry.context === "C1" ? "/c1" : "/dashboard";
    router.push(`${screen}?focus=${entry.eventId}`);
  }

  return (
    <div className="space-y-3">
      <Card>
        <PageHeader
          title="Team"
          subtitle={
            peopleCount === 0
              ? "Nobody is marked as in progress."
              : `${peopleCount} ${peopleCount === 1 ? "person is" : "people are"} working right now.`
          }
        />
      </Card>

      {groups.length === 0 ? (
        <EmptyState
          title="Nobody is working right now"
          description="When somebody presses Start on the Dashboard or in C1, they appear here with what they are on and how long they have been on it."
        />
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const lead = group[0];
            if (!lead) return null;

            return (
              <Card key={lead.userId}>
                <div className="space-y-2 p-3">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="jpd-live-dot h-2 w-2 shrink-0 rounded-full"
                      style={{ background: "var(--live)" }}
                    />
                    <UserChip
                      name={lead.userName}
                      color={lead.userColor}
                      className="text-[13px] font-medium"
                    />
                    {group.length > 1 ? (
                      <span
                        className="text-[11px] tabular-nums"
                        style={{ color: "var(--ink-subtle)" }}
                      >
                        {group.length} events
                      </span>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    {group.map((entry) => {
                      const stale = entry.minutesActive >= LONG_RUNNING_MINUTES;

                      return (
                        <button
                          key={`${entry.eventId}:${entry.context}`}
                          type="button"
                          onClick={() => jumpTo(entry)}
                          title={`Open this event on the ${entry.context === "C1" ? "C1" : "Dashboard"}`}
                          className="jpd-hover-ring flex w-full items-start justify-between gap-2 rounded-md border p-2 text-left"
                          style={{ borderColor: "var(--line)" }}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12.5px] font-medium">
                              {entry.label}
                            </span>
                            <span
                              className="mt-0.5 block text-[11px]"
                              style={{ color: "var(--ink-subtle)" }}
                            >
                              {formatPlainDateWithWeekday(entry.eventDate)}
                              {entry.venue ? ` · ${entry.venue}` : ""}
                              {entry.context === "C1" ? " · C1" : " · Dashboard"}
                            </span>
                          </span>

                          <span
                            className="shrink-0 rounded px-1.5 py-0.5 text-[11.5px] font-semibold tabular-nums"
                            style={
                              stale
                                ? { background: "var(--warn-soft)", color: "var(--warn)" }
                                : { background: "var(--live-soft)", color: "var(--live)" }
                            }
                          >
                            {formatElapsed(entry.minutesActive)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
