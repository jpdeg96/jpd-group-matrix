/**
 * What each notification says.
 *
 * Pure builders, separate from delivery, so the wording of a payroll run can be
 * tested without a webhook and the client can be swapped without rewriting any
 * of this. Nothing here reaches the network or the database.
 *
 * The audience is the team in a chat channel, not an operator reading logs:
 * every message says what happened and, where there is one, what to do about
 * it. None of them carry money figures beyond the run total, and none carry a
 * credential.
 */

import type { Announcement } from "@/lib/domain/announcements";
import type { NotifyMessage } from "./discord";

/** Canonical deployment URL, when one is configured. No trailing slash. */
export function appUrl(): string | null {
  const raw = process.env.AUTH_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function link(path: string): string | undefined {
  const base = appUrl();
  return base ? `${base}${path}` : undefined;
}

const KIND_VERB: Record<Announcement["kind"], string> = {
  added: "New",
  changed: "Changed",
  fixed: "Fixed",
  removed: "Removed",
};

/**
 * A release went out.
 *
 * Driven by the same announcement list the in-app popup uses, so the channel
 * and the app cannot describe a release differently — there is only one source
 * for both.
 */
export function releaseMessage(released: readonly Announcement[]): NotifyMessage {
  const headline =
    released.length === 1
      ? released[0]!.title
      : `${released.length} changes are live`;

  return {
    title: `Update deployed — ${headline}`,
    description:
      released.length === 1
        ? released[0]!.body
        : "Everyone will see these in the app on their next load.",
    tone: "good",
    url: link("/help"),
    fields:
      released.length === 1
        ? undefined
        : released.map((entry) => ({
            name: `${KIND_VERB[entry.kind]} · ${entry.title}`,
            value: entry.body,
          })),
    footer: "JPD Group Matrix",
  };
}

/**
 * Clockify started or stopped answering.
 *
 * Only ever sent on a transition. Repeating "still down" every hour trains
 * people to mute the channel, which costs you the message that matters.
 */
export function clockifyHealthMessage(healthy: boolean, detail: string | null): NotifyMessage {
  return healthy
    ? {
        title: "Clockify is responding again",
        description: "Hours and clock-in status are live once more.",
        tone: "good",
        footer: "JPD Group Matrix",
      }
    : {
        title: "Clockify is not responding",
        description:
          "Hours on Metrics and clock-in status will be stale until it recovers. Event review is unaffected.",
        tone: "warn",
        fields: detail ? [{ name: "Reported", value: detail }] : undefined,
        footer: "JPD Group Matrix",
      };
}

/** Sent by the test button in Settings, so setup can be proved before an event. */
export function testMessage(triggeredBy: string): NotifyMessage {
  return {
    title: "Test notification",
    description:
      "Notifications are working. Real ones arrive when a release deploys, or when Clockify stops or starts responding.",
    tone: "info",
    fields: [{ name: "Sent by", value: triggeredBy, inline: true }],
    footer: "JPD Group Matrix",
  };
}
