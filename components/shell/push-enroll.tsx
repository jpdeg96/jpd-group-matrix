"use client";

import * as React from "react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/ui/api-client";

/**
 * Remembered per browser, because the answer is per browser.
 *
 * Somebody who declines on their laptop has not declined on their phone, and
 * the phone is the one this is for. A server-side "dismissed" flag would carry
 * the laptop's answer across and silently stop the offer where it mattered.
 */
const DISMISSED_KEY = "jpd.push.dismissed";

/**
 * `BNUB…` as the byte array `PushManager.subscribe` expects.
 *
 * Backed by an explicit ArrayBuffer rather than letting `new Uint8Array(n)`
 * infer one: the DOM types require an `ArrayBuffer` specifically, and the
 * inferred `ArrayBufferLike` admits `SharedArrayBuffer`, which they reject.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/** Running as an installed app rather than in a browser tab. */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // Safari's own flag. iOS did not support the media query for installed web
  // apps for a long time, and this is the only reliable signal there.
  return (window.navigator as { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

type State =
  | "checking"
  | "unsupported"
  | "needs-install"
  | "offer"
  | "subscribed"
  | "denied";

/**
 * Turns on lock-screen notifications, and explains the one thing that trips
 * everybody up.
 *
 * On iOS, Safari will not deliver a push to a site open in a tab — only to one
 * that has been added to the Home Screen. That is not a limitation we can code
 * around, so the honest thing is to say so plainly and show the three taps,
 * rather than offer a button that silently cannot work.
 */
export function PushEnroll() {
  const toast = useToast();
  const [state, setState] = React.useState<State>("checking");
  const [publicKey, setPublicKey] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (localStorage.getItem(DISMISSED_KEY) === "1") setDismissed(true);
      } catch {
        // Private window or blocked storage. Showing the offer is the right
        // failure: worst case somebody dismisses it twice.
      }

      const config = await api
        .get<{ enabled: boolean; publicKey: string | null; devices: number }>("/api/push")
        .catch(() => null);

      if (cancelled) return;

      // Not configured on this server: the whole feature is off, and there is
      // nothing to offer or explain.
      if (!config?.enabled || !config.publicKey) {
        setState("unsupported");
        return;
      }
      setPublicKey(config.publicKey);

      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        // On iOS this is what a plain Safari tab looks like, and the fix is to
        // install rather than to give up.
        setState(isIos() && !isStandalone() ? "needs-install" : "unsupported");
        return;
      }

      if (isIos() && !isStandalone()) {
        setState("needs-install");
        return;
      }

      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }

      // Already subscribed on this device? Ask the browser, not the server:
      // the server knows about endpoints, and only the browser knows whether
      // this particular one is still live.
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const existing = await registration?.pushManager.getSubscription();
      if (cancelled) return;

      setState(existing ? "subscribed" : "offer");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);

    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Must follow a real tap: every browser refuses this from a timer or a
      // page load, and iOS refuses it outright outside an installed app.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "offer");
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        // Required to be true by every browser: a push that shows nothing is
        // not allowed, which is also why there is no silent background sync.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await api.post("/api/push", subscription.toJSON());
      setState("subscribed");
      toast.success("Notifications are on for this device.");
    } catch (error) {
      toast.error(
        "Could not turn on notifications.",
        error instanceof Error ? error.message : undefined,
      );
      setState("offer");
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Then it comes back next time, which is a smaller problem than throwing.
    }
  }

  // Nothing to say: already on, impossible here, or waved away.
  if (dismissed || state === "checking" || state === "unsupported" || state === "subscribed") {
    return null;
  }

  return (
    <div
      className="mb-3 rounded-lg border p-3 md:hidden"
      style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
    >
      {state === "needs-install" ? (
        <>
          <p className="text-[13px] font-semibold">Get flags on your lock screen</p>
          <p className="mt-1 text-[12px]" style={{ color: "var(--ink-muted)" }}>
            iPhone only sends notifications to apps on your Home Screen, not to
            Safari tabs. Tap{" "}
            <span aria-hidden>􀈂</span> <strong>Share</strong> at the bottom of
            Safari, then <strong>Add to Home Screen</strong>. Open the site from
            that icon and the option to turn notifications on will be here.
          </p>
        </>
      ) : state === "denied" ? (
        <>
          <p className="text-[13px] font-semibold">Notifications are blocked</p>
          <p className="mt-1 text-[12px]" style={{ color: "var(--ink-muted)" }}>
            This device refused them at some point, and only you can undo that —
            in Settings, under Notifications, find this app and allow them.
          </p>
        </>
      ) : (
        <>
          <p className="text-[13px] font-semibold">Turn on notifications</p>
          <p className="mt-1 text-[12px]" style={{ color: "var(--ink-muted)" }}>
            Flags raised on your events and notes that mention you, on this
            device, as they happen.
          </p>
        </>
      )}

      <div className="mt-2 flex items-center gap-2">
        {state === "offer" ? (
          <Button size="sm" variant="primary" loading={busy} onClick={() => void enable()}>
            Turn on
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={dismiss}>
          {state === "offer" ? "Not now" : "Got it"}
        </Button>
      </div>
    </div>
  );
}
