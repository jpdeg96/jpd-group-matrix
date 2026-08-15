/**
 * Minimal email client (Resend REST API).
 *
 * Written against `fetch` rather than pulling in a package, matching the
 * Clockify client: one endpoint, a bearer token, and a timeout.
 *
 * The credential lives in `RESEND_API_KEY` and the sender in
 * `RESEND_FROM_EMAIL`, never in the database — the same rule the Clockify key
 * follows, so a database dump cannot carry a live credential.
 *
 * Switching provider means rewriting `send` and nothing else: everything above
 * this file deals in `EmailMessage`.
 */

const BASE_URL = "https://api.resend.com";
const TIMEOUT_MS = 10_000;

export class EmailError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "EmailError";
    this.status = status;
  }
}

export function emailApiKey(): string | null {
  return process.env.RESEND_API_KEY?.trim() || null;
}

export function emailFromAddress(): string | null {
  return process.env.RESEND_FROM_EMAIL?.trim() || null;
}

/** Both halves are needed; one without the other cannot send. */
export function isEmailConfigured(): boolean {
  return emailApiKey() !== null && emailFromAddress() !== null;
}

export interface EmailAttachment {
  filename: string;
  /** Base64, which is what the API takes. */
  content: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Display name for the sender; the address comes from the environment. */
  fromName: string;
  attachments?: EmailAttachment[];
}

export async function sendEmail(message: EmailMessage): Promise<{ id: string }> {
  const key = emailApiKey();
  const from = emailFromAddress();

  if (!key || !from) {
    throw new EmailError(
      500,
      "Email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL on the server, then restart it.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
      body: JSON.stringify({
        from: `${message.fromName} <${from}>`,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.attachments?.length
          ? { attachments: message.attachments }
          : {}),
      }),
    });

    const body = (await response.json().catch(() => null)) as
      | { id?: string; message?: string; name?: string }
      | null;

    if (!response.ok) {
      throw new EmailError(
        response.status,
        response.status === 401
          ? // The same trap as the Clockify key: the process reads the
            // environment once at start, so a rotated key without a restart
            // presents as a rejected one.
            "Resend rejected the API key. If you have just changed RESEND_API_KEY, restart the server — the environment is only read at startup."
          : response.status === 403
            ? `Resend refused to send from ${from}. That domain probably is not verified yet.`
            : (body?.message ?? `Resend returned ${response.status}.`),
      );
    }

    return { id: body?.id ?? "" };
  } catch (error) {
    if (error instanceof EmailError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new EmailError(504, "Resend did not respond in time.");
    }
    throw new EmailError(502, "Could not reach Resend.");
  } finally {
    clearTimeout(timer);
  }
}
