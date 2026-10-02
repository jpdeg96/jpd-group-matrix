"use client";

import * as React from "react";
import { Button, Card, PageHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/ui/api-client";
import type { PushCategoryEntry } from "@/lib/domain/push-categories";

/**
 * Remembered per browser, because the answer is per browser.
 *
 * Somebody who declines on their laptop has not declined on their phone, and
 * the phone is usually the one that matters. A server-side "dismissed" flag
 * would carry one device's answer to every other.
 */
const DISMISSED_KEY = "jpd.push.dismissed";

/** `BNUB…` as the byte array `PushManager.subscribe` expects. */
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
  // Safari's own flag: iOS did not support the media query for installed web
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

type DeviceState =
  | "checking"
  | "unsupported"
  | "needs-install"
  | "offer"
  | "subscribed"
  | "denied";

/**
 * Notifications: this device, and what reaches it.
 *
 * Two halves that belong together. The switches are per person and follow them
 * everywhere; turning them on is per device and does not. Keeping them in one
 * card is what makes that difference visible — somebody who has ticked
 * Mentions and still hears nothing can see, in the same place, that this
 * particular browser was never enabled.
 *
 * Shown at every width. Desktop Chrome delivers push perfectly well, and a
 * person at their desk is more likely to be the one configuring this than
 * somebody holding a phone.
 */
export function NotificationSettings({
  categories,
  muted: initialMuted,
}: {
  /** Only the ones this person's role may actually be told about. */
  categories: readonly PushCategoryEntry[];
  muted: readonly string[];
}) {
  const toast = useToast();

  const [device, setDevice] = React.useState<DeviceState>("checking");
  const [publicKey, setPublicKey] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dismissedHint, setDismissedHint] = React.useState(false);

  const [muted, setMuted] = React.useState<readonly string[]>(initialMuted);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (localStorage.getItem(DISMISSED_KEY) === "1") setDismissedHint(true);
      } catch {
        // Private window or blocked storage. Showing the hint is the right
        // failure: worst case somebody dismisses it twice.
      }

      const config = await api
        .get<{ enabled: boolean; publicKey: string | null; devices: number }>("/api/push")
        .catch(() => null);

      if (cancelled) return;

      if (!config?.enabled || !config.publicKey) {
        setDevice("unsupported");
        return;
      }
      setPublicKey(config.publicKey);

      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        // On iOS this is exactly what a plain Safari tab looks like, and the
        // fix is to install rather than to give up.
        setDevice(isIos() && !isStandalone() ? "needs-install" : "unsupported");
        return;
      }

      if (isIos() && !isStandalone()) {
        setDevice("needs-install");
        return;
      }

      if (Notification.permission === "denied") {
        setDevice("denied");
        return;
      }

      // Ask the browser, not the server: the server knows about endpoints, and
      // only the browser knows whether this particular one is still live.
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const existing = await registration?.pushManager.getSubscription();
      if (cancelled) return;

      setDevice(existing ? "subscribed" : "offer");
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
        setDevice(permission === "denied" ? "denied" : "offer");
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        // Required true by every browser: a push that shows nothing is not
        // allowed, which is also why there is no silent background sync.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await api.post("/api/push", subscription.toJSON());
      setDevice("subscribed");
      toast.success("Notifications are on for this device.");
    } catch (error) {
      toast.error(
        "Could not turn on notifications.",
        error instanceof Error ? error.message : undefined,
      );
      setDevice("offer");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        // Told to the server first. If the browser forgets it and the server
        // does not, the row lives on until it fails five times.
        await api
          .delete("/api/push", { endpoint: subscription.endpoint })
          .catch(() => undefined);
        await subscription.unsubscribe();
      }

      setDevice("offer");
      toast.success("Notifications are off for this device.");
    } catch (error) {
      toast.error(
        "Could not turn notifications off.",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  async function setCategory(key: string, wanted: boolean) {
    const next = wanted ? muted.filter((item) => item !== key) : [...muted, key];
    const previous = muted;

    // Optimistic, rolled back on refusal: a checkbox that waits for a round
    // trip before moving reads as broken.
    setMuted(next);
    setSaving(true);
    try {
      await api.patch("/api/preferences", { pushMuted: next });
    } catch {
      setMuted(previous);
      toast.error("Could not save that preference.");
    } finally {
      setSaving(false);
    }
  }

  function dismissHint() {
    setDismissedHint(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Then it comes back next time, which is smaller than throwing.
    }
  }

  // Push is not configured on this server. The switches would be a set of
  // controls over something that cannot happen.
  if (device === "unsupported") return null;

  return (
    <Card>
      <PageHeader
        title="Notifications"
        subtitle="What reaches you when the site is not open."
      />

      <div className="space-y-3 px-5 py-4">
        {/* This device ------------------------------------------------- */}
        <div
          className="rounded-lg border p-3"
          style={{
            borderColor: device === "subscribed" ? "var(--success)" : "var(--line-strong)",
            background: device === "subscribed" ? "var(--success-soft)" : "var(--canvas)",
          }}
        >
          {device === "subscribed" ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12.5px] font-medium" style={{ color: "var(--success)" }}>
                This device is on.
              </span>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void disable()}>
                Turn off here
              </Button>
            </div>
          ) : device === "needs-install" ? (
            <>
              <p className="text-[13px] font-semibold">Add this to your Home Screen first</p>
              <p className="mt-1 text-[12px]" style={{ color: "var(--ink-muted)" }}>
                iPhone only sends notifications to apps on the Home Screen, never
                to a Safari tab. Tap <strong>Share</strong> at the bottom of
                Safari, then <strong>Add to Home Screen</strong>, and open the
                site from that icon — the button to turn them on will be here.
              </p>
              {!dismissedHint ? (
                <Button size="sm" variant="ghost" className="mt-2" onClick={dismissHint}>
                  Got it
                </Button>
              ) : null}
            </>
          ) : device === "denied" ? (
            <>
              <p className="text-[13px] font-semibold">Blocked on this device</p>
              <p className="mt-1 text-[12px]" style={{ color: "var(--ink-muted)" }}>
                This browser refused notifications at some point, and only you
                can undo that — in its site settings, or in your phone&apos;s
                Settings under Notifications.
              </p>
            </>
          ) : device === "checking" ? (
            <p className="text-[12px]" style={{ color: "var(--ink-subtle)" }}>
              Checking this device…
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
                This device is off. Turning it on covers this browser only —
                each phone or computer is asked separately.
              </span>
              <Button size="sm" variant="primary" loading={busy} onClick={() => void enable()}>
                Turn on
              </Button>
            </div>
          )}
        </div>

        {/* What to send ------------------------------------------------ */}
        <div className="space-y-1">
          {categories.map((category) => {
            const on = !muted.includes(category.key);

            return (
              <label
                key={category.key}
                className="flex cursor-pointer items-start gap-3 rounded-md p-2"
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={saving}
                  onChange={(event) => void setCategory(category.key, event.target.checked)}
                  style={{ accentColor: "var(--accent)" }}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{category.label}</span>
                  <span
                    className="mt-0.5 block text-[12px]"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    {category.detail}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        <p className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
          These follow you to every device. Turning one off silences the
          notification, not the bell — it still appears in this list.
        </p>
      </div>
    </Card>
  );
}
