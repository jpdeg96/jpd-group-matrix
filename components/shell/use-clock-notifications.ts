"use client";

import * as React from "react";
import { useToast } from "@/components/ui/toast";
import {
  describeClockChange,
  diffClockSnapshots,
  snapshotFrom,
  type ClockReading,
  type ClockSnapshot,
} from "@/lib/domain/clock-transitions";

/**
 * Announces Clockify clock-in and clock-out transitions as toasts.
 *
 * The comparison itself lives in `lib/domain/clock-transitions.ts`; this hook
 * only holds the previous reading, suppresses duplicates across tabs, and turns
 * the result into toasts.
 *
 * Driven by the poll the widget already runs, so it costs no extra requests.
 * The trade-offs that buys: announcements only reach people with the app open,
 * and arrive up to one poll late. Neither affects the timekeeping, which is
 * always Clockify's.
 */

const ANNOUNCED_KEY = "jpd.clockify.announced";

/**
 * How long the same transition stays suppressed across tabs.
 *
 * Comfortably longer than the poll interval, so a second tab polling a moment
 * later recognises the announcement as already made rather than repeating it.
 */
const DEDUPE_MS = 45_000;

type AnnouncedMap = Record<string, number>;

/**
 * Shows a toast unless another tab already showed this exact one.
 *
 * Two tabs open is normal here — the Dashboard in one, C1 in the other — and
 * each polls independently, so without this every clock-in is announced twice.
 * localStorage is shared across tabs of an origin, which makes it the cheapest
 * coordination point available. Failing is harmless: the worst case is the
 * duplicate toast there would have been anyway.
 */
function announceOnce(signature: string, show: () => void): void {
  try {
    const now = Date.now();
    const raw = window.localStorage.getItem(ANNOUNCED_KEY);
    const seen: AnnouncedMap = raw ? (JSON.parse(raw) as AnnouncedMap) : {};

    const last = seen[signature];
    if (last !== undefined && now - last < DEDUPE_MS) return;

    // Prune while we are here, so the entry cannot grow without bound.
    const fresh: AnnouncedMap = { [signature]: now };
    for (const [key, at] of Object.entries(seen)) {
      if (now - at < DEDUPE_MS) fresh[key] = at;
    }
    window.localStorage.setItem(ANNOUNCED_KEY, JSON.stringify(fresh));
  } catch {
    // Private browsing, or storage full. Announcing twice beats not at all.
  }

  show();
}

export function useClockNotifications(reading: ClockReading | null): void {
  const { toast } = useToast();
  const previous = React.useRef<ClockSnapshot | null>(null);

  React.useEffect(() => {
    if (!reading) return;

    // A failed reading reports no running timer and an empty roster. Diffing
    // that would announce the whole team clocking out, so hold the baseline and
    // wait for a good one — on recovery the diff is then a no-op.
    if (reading.error) return;

    const next = snapshotFrom(reading);
    const changes = diffClockSnapshots(previous.current, next, {
      linked: reading.linked,
    });
    previous.current = next;

    if (changes.self) {
      const running = changes.self === "in";
      announceOnce(`self:${changes.self}`, () =>
        toast(running ? "You're clocked in." : "You're clocked out.", {
          tone: running ? "success" : "info",
        }),
      );
    }

    // Signed by *who* rather than how many, so two different people clocking in
    // one poll apart produce two announcements instead of one suppressed.
    if (changes.arrived.length > 0) {
      announceOnce(`in:${changes.arrivedIds.join(",")}`, () =>
        toast(describeClockChange(changes.arrived, "clocked in"), { tone: "info" }),
      );
    }

    if (changes.departed.length > 0) {
      announceOnce(`out:${changes.departedIds.join(",")}`, () =>
        toast(describeClockChange(changes.departed, "clocked out"), { tone: "info" }),
      );
    }
  }, [reading, toast]);
}
