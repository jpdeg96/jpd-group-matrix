/**
 * Minimal Discord webhook client.
 *
 * Written against `fetch` rather than a package, matching the Clockify and
 * Resend clients: one endpoint, a URL that is itself the credential, and a
 * timeout. The URL lives in `DISCORD_WEBHOOK_URL` and never in the database —
 * anyone holding it can post to the channel, so it follows the same rule as
 * every other secret here and a database dump cannot carry it.
 *
 * ## Failures are swallowed on purpose
 *
 * `notify` never throws. A notification is a side effect of work that has
 * already happened: payroll has been emailed, the release is live. Letting
 * Discord being unreachable fail that work would be the integration causing the
 * outage it exists to report. Problems are logged and reported through the
 * return value for anything that wants to surface them — the test button does.
 */

const TIMEOUT_MS = 8_000;

/** Discord's own limits. Exceeding either is a 400, so they are enforced here. */
const MAX_EMBED_DESCRIPTION = 4096;
const MAX_FIELD_VALUE = 1024;

export type NotifyTone = "info" | "good" | "warn" | "bad";

/** Left-edge colour of the embed. Semantic, not decorative. */
const TONE_COLORS: Record<NotifyTone, number> = {
  info: 0x2563eb,
  good: 0x067647,
  warn: 0xb54708,
  bad: 0xb42318,
};

export interface NotifyField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface NotifyMessage {
  title: string;
  description?: string;
  tone?: NotifyTone;
  fields?: NotifyField[];
  /** Small line at the foot of the embed — usually which environment sent it. */
  footer?: string;
  url?: string;
}

export interface NotifyResult {
  delivered: boolean;
  /** Present when it did not go out. Safe to show an administrator. */
  error?: string;
}

export function discordWebhookUrl(): string | null {
  return process.env.DISCORD_WEBHOOK_URL?.trim() || null;
}

export function isDiscordConfigured(): boolean {
  return discordWebhookUrl() !== null;
}

function clamp(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

/**
 * Posts one embed to the configured channel.
 *
 * Resolves either way. Check `delivered` if the caller has somewhere sensible
 * to report a failure; ignore it otherwise.
 */
export async function notify(message: NotifyMessage): Promise<NotifyResult> {
  const url = discordWebhookUrl();
  if (!url) {
    return { delivered: false, error: "DISCORD_WEBHOOK_URL is not set." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      cache: "no-store",
      body: JSON.stringify({
        embeds: [
          {
            title: clamp(message.title, 256),
            ...(message.description
              ? { description: clamp(message.description, MAX_EMBED_DESCRIPTION) }
              : {}),
            ...(message.url ? { url: message.url } : {}),
            color: TONE_COLORS[message.tone ?? "info"],
            timestamp: new Date().toISOString(),
            ...(message.fields?.length
              ? {
                  // Discord caps an embed at 25 fields and drops the whole
                  // message if there are more, so this truncates rather than
                  // losing the notification entirely.
                  fields: message.fields.slice(0, 25).map((field) => ({
                    name: clamp(field.name, 256),
                    value: clamp(field.value, MAX_FIELD_VALUE),
                    inline: field.inline ?? false,
                  })),
                }
              : {}),
            ...(message.footer ? { footer: { text: clamp(message.footer, 2048) } } : {}),
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const error =
        response.status === 401 || response.status === 404
          ? "Discord rejected the webhook URL. It has probably been deleted or regenerated — replace DISCORD_WEBHOOK_URL and restart."
          : response.status === 429
            ? "Discord is rate-limiting this webhook."
            : `Discord returned ${response.status}. ${clamp(detail, 200)}`.trim();

      console.warn("[discord] not delivered:", error);
      return { delivered: false, error };
    }

    return { delivered: true };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? "Discord did not respond in time."
        : "Could not reach Discord.";
    console.warn("[discord] not delivered:", reason);
    return { delivered: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}
