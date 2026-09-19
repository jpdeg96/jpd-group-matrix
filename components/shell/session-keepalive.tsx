"use client";

import * as React from "react";

/** How often an active session is renewed. Far inside the 12-hour lifetime. */
const RENEW_EVERY_MS = 15 * 60_000;

/** Interaction this recent counts as "somebody is here". */
const ACTIVE_WITHIN_MS = RENEW_EVERY_MS;

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;

/**
 * Keeps the session alive while somebody is actually using the site.
 *
 * The session cookie is issued at sign-in with a 12-hour life, and nothing
 * renewed it: there is no middleware and no client session provider, and a
 * server component can read a cookie but not rewrite it. So every session ended
 * exactly twelve hours after sign-in however busy its owner was — which, to the
 * person it happened to, was being logged out at a random moment mid-task.
 *
 * Auth.js re-issues the cookie with a fresh expiry whenever its own session
 * endpoint is read, so this reads it on a timer.
 *
 * Only while there has been *activity*, deliberately. Renewing merely because
 * a tab is open would keep a forgotten tab on an unlocked machine signed in
 * forever. Tied to activity, the 12 hours keeps its original meaning as an idle
 * limit: somebody working is never interrupted, and a session nobody is using
 * still expires.
 */
export function SessionKeepAlive() {
  React.useEffect(() => {
    let lastActivity = Date.now();
    let lastRenewal = Date.now();

    const renew = () => {
      lastRenewal = Date.now();
      // The response body is irrelevant; the Set-Cookie on it is the point.
      // Failures are ignored — the next tick tries again, and a genuinely
      // expired session is reported by whatever request hits it next.
      void fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" }).catch(
        () => undefined,
      );
    };

    const markActive = () => {
      lastActivity = Date.now();
    };

    /*
     * Coming back to the tab renews at once if it has been a while. A laptop
     * closed over lunch is the commonest way to sit idle and then resume, and
     * waiting for the next tick would leave the first click of the afternoon
     * running on a session that may be minutes from its end.
     */
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      markActive();
      if (Date.now() - lastRenewal > RENEW_EVERY_MS) renew();
    };

    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, markActive, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisible);

    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity <= ACTIVE_WITHIN_MS) renew();
    }, RENEW_EVERY_MS);

    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, markActive);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
