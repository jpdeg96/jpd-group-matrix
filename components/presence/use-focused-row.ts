"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

/** How long the highlight stays before fading out. */
const HIGHLIGHT_MS = 4_000;

/**
 * How long the row is held in the middle of the screen.
 *
 * Long enough to outlast a cold render of six hundred rows and the first
 * live-refresh behind it, which is what moves the page; short enough that it is
 * over before anybody would want to scroll. A user gesture ends it early
 * regardless.
 */
const HOLD_MS = 2_500;

/** Close enough to the middle of the screen to leave alone. */
const CENTRE_TOLERANCE_PX = 8;

/** How often the row's position is checked while it is being held. */
const TICK_MS = 50;

/** The DOM id a focusable row must carry. */
export function rowElementId(eventId: string): string {
  return `event-row-${eventId}`;
}

/**
 * "Take me to that row", driven by `?focus=<eventId>`.
 *
 * Landing on a table with the right row somewhere in six hundred is not
 * arriving anywhere, so the link is only half the job — the row has to be
 * brought to the middle of the screen and then say which one it is.
 *
 * Clearing the filters is the caller's job, because each screen filters
 * differently and both would otherwise hide the row they were just asked to
 * show: the Dashboard defaults to open work, and C1 defaults to today's
 * reviews. The hook reports the id, waits for the row to appear, and takes it
 * from there.
 */
export function useFocusedRow(): string | null {
  const params = useSearchParams();
  const focusId = params.get("focus");

  React.useEffect(() => {
    if (!focusId) return;

    let cancelled = false;
    let loopTimer: ReturnType<typeof setTimeout> | undefined;
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;
    let highlighted: HTMLElement | null = null;
    let deadline = 0;

    /*
     * Scrolling once is not enough, and this is the whole difficulty.
     *
     * Two separate things move the page out from under a single scroll.
     * Clearing the filters is a state update, so the table re-renders a frame
     * later — and it re-renders *longer*, because clearing a filter can only
     * add rows, and every row inserted above this one pushes it further down.
     * Then the live-refresh arrives: the presence stream delivers a revision
     * within the first second or so, the screen re-reads, and that lands the
     * page back at the top. Either one on its own leaves you looking at row
     * four hundred instead of the one you asked for.
     *
     * So rather than scrolling once and hoping, the row is held in the middle
     * for a couple of seconds and put back whenever something moves it.
     * Instant rather than smooth, deliberately: a smooth scroll is still
     * animating while the content shifts under it, and has nothing to animate
     * towards.
     */
    const step = () => {
      if (cancelled) return;

      const element = document.getElementById(rowElementId(focusId));

      if (element) {
        // Marked as soon as it exists, so the row is already identifiable
        // while the last of the rendering settles.
        if (highlighted !== element) {
          highlighted?.classList.remove("jpd-focus-row");
          element.classList.add("jpd-focus-row");
          highlighted = element;

          highlightTimer = setTimeout(() => {
            element.classList.remove("jpd-focus-row");
          }, HIGHLIGHT_MS);
        }

        const box = element.getBoundingClientRect();
        const offset = (box.top + box.bottom) / 2 - window.innerHeight / 2;
        if (Math.abs(offset) > CENTRE_TOLERANCE_PX) {
          element.scrollIntoView({ behavior: "auto", block: "center" });
        }
      }

      if (Date.now() < deadline) loopTimer = setTimeout(step, TICK_MS);
    };

    /*
     * A timer rather than requestAnimationFrame, and the distinction matters.
     *
     * rAF does not run at all in a tab that is not being composited, so opening
     * one of these links in a background tab — which is exactly what a middle
     * click or "open in new tab" does — meant the row was never brought into
     * view. By the time the tab was looked at, nothing had happened and the
     * page was sitting at the top with no indication of why it had been opened.
     *
     * So the clock only starts once the page is actually visible, and the loop
     * is driven by a timer, which runs either way.
     */
    const begin = () => {
      if (cancelled || deadline !== 0) return;
      deadline = Date.now() + HOLD_MS;
      step();
    };

    /*
     * Holding the row in place is only defensible while the movement is ours.
     * The moment somebody scrolls, or reaches for the keyboard, they have taken
     * over — continuing to drag the viewport back would be the page fighting
     * its reader, which is far worse than landing in the wrong place.
     */
    const release = () => {
      cancelled = true;
      if (loopTimer) clearTimeout(loopTimer);
    };
    const once = { passive: true, once: true } as const;
    window.addEventListener("wheel", release, once);
    window.addEventListener("touchstart", release, once);
    window.addEventListener("keydown", release, once);

    const onVisible = () => {
      if (!document.hidden) begin();
    };
    document.addEventListener("visibilitychange", onVisible);
    onVisible();

    return () => {
      cancelled = true;
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchstart", release);
      window.removeEventListener("keydown", release);
      document.removeEventListener("visibilitychange", onVisible);
      if (loopTimer) clearTimeout(loopTimer);
      if (highlightTimer) clearTimeout(highlightTimer);
      highlighted?.classList.remove("jpd-focus-row");
    };
  }, [focusId]);

  return focusId;
}
