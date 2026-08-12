"use client";

import * as React from "react";
import { api } from "@/lib/ui/api-client";
import {
  milestoneReached,
  type CompletionMilestone,
} from "@/lib/domain/completion-milestones";

interface TodayProgress {
  completedToday: number;
  shiftSeconds: number | null;
}

/**
 * Remembers the highest milestone celebrated, per person, per day.
 *
 * Without this, every reload re-checks a count that is still over the line and
 * fires again — so the reward for a good day would be confetti on every page
 * load until midnight. Keyed by business date so it resets on its own and
 * cannot accumulate.
 */
function storageKey(userId: string, businessDate: string): string {
  return `jpd.celebrated.${userId}.${businessDate}`;
}

function readCelebrated(userId: string, businessDate: string): number {
  try {
    const raw = window.localStorage.getItem(storageKey(userId, businessDate));
    const value = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeCelebrated(userId: string, businessDate: string, count: number): void {
  try {
    // Drop yesterday's entries while we are here; nothing else prunes them.
    const prefix = `jpd.celebrated.${userId}.`;
    const keep = storageKey(userId, businessDate);
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(prefix) && key !== keep) window.localStorage.removeItem(key);
    }
    window.localStorage.setItem(keep, String(count));
  } catch {
    // Private browsing: the worst case is a repeat celebration.
  }
}

/**
 * Fires a milestone celebration when this person's completions cross a target.
 *
 * `check()` is called after a completion actually lands on the server, rather
 * than on the optimistic update — celebrating a completion that then fails
 * would be worse than celebrating late.
 */
export function useCompletionCelebration(userId: string, businessDate: string) {
  const [celebrating, setCelebrating] = React.useState<CompletionMilestone | null>(null);

  const check = React.useCallback(async () => {
    try {
      const { progress } = await api.get<{ progress: TodayProgress }>("/api/me/today");

      const alreadyCelebrated = readCelebrated(userId, businessDate);
      const milestone = milestoneReached({
        completedToday: progress.completedToday,
        shiftSeconds: progress.shiftSeconds,
        alreadyCelebrated,
      });

      if (!milestone) return;

      writeCelebrated(userId, businessDate, milestone.count);
      setCelebrating(milestone);
    } catch {
      // A missed celebration is not worth surfacing an error for.
    }
  }, [userId, businessDate]);

  const dismiss = React.useCallback(() => setCelebrating(null), []);

  return { celebrating, check, dismiss };
}
