/**
 * Minimal Clockify REST client (API v1).
 *
 * The API key lives in the CLOCKIFY_API_KEY environment variable, never in the
 * database and never in a response body — a database dump should not contain a
 * live credential, and the browser never needs one because all calls are made
 * server-side.
 *
 * Every call is timeout-bounded. Clockify being slow or down must degrade the
 * time widget, not hang a page render.
 */

const BASE_URL = "https://api.clockify.me/api/v1";
const TIMEOUT_MS = 6_000;

export class ClockifyError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ClockifyError";
    this.status = status;
  }
}

export function clockifyApiKey(): string | null {
  return process.env.CLOCKIFY_API_KEY?.trim() || null;
}

export function isClockifyConfigured(): boolean {
  return clockifyApiKey() !== null;
}

async function request<T>(path: string): Promise<T> {
  const key = clockifyApiKey();
  if (!key) throw new ClockifyError(500, "CLOCKIFY_API_KEY is not configured.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: { "X-Api-Key": key, "Content-Type": "application/json" },
      signal: controller.signal,
      // Time data is live; a cached answer would be worse than none.
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ClockifyError(
        response.status,
        response.status === 401
          ? // The overwhelmingly common cause is a rotated key with a server
            // that has not been restarted — .env is read once at process
            // start, so the running process still holds the old value. Say so,
            // because "rejected the API key" sends people to check the key
            // itself, which is the one thing that is usually fine.
            "Clockify rejected the API key. If you have just changed CLOCKIFY_API_KEY, restart the server — .env is only read at startup, so a running process keeps using the old key."
          : response.status === 403
            ? "That API key cannot read this workspace. Check the workspace ID in Settings matches the account the key belongs to."
            : response.status === 404
              ? "Clockify workspace or user not found. Check the workspace ID in Settings and the linked Clockify user under Users."
              : response.status === 429
                ? // Called out separately because the fix is a plan, not a
                  // setting, and the generic message sends people hunting
                  // through configuration that is perfectly correct. Newly
                  // created Free workspaces allow only 30 requests per hour
                  // for the whole workspace; this integration polls well above
                  // that. See the Clockify section of the README.
                  "Clockify is rate-limiting this workspace. Free workspaces created recently allow only 30 API requests per hour in total, which this integration exceeds. The data will keep lapsing until the workspace is on a paid plan or the polling is slowed right down."
                : `Clockify returned ${response.status}. ${body.slice(0, 200)}`,
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ClockifyError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ClockifyError(504, "Clockify did not respond in time.");
    }
    throw new ClockifyError(502, "Could not reach Clockify.");
  } finally {
    clearTimeout(timer);
  }
}

export interface ClockifyTimeInterval {
  start: string;
  end: string | null;
  /** ISO-8601 duration, e.g. `PT1H30M`. Null while the timer is running. */
  duration: string | null;
}

export interface ClockifyTimeEntry {
  id: string;
  description: string;
  timeInterval: ClockifyTimeInterval;
}

export interface ClockifyWorkspaceUser {
  id: string;
  email: string;
  name: string;
  status: string;
}

/** Time entries for one user, newest first, bounded by an instant range. */
export function getTimeEntries(
  workspaceId: string,
  clockifyUserId: string,
  options: { start: Date; end: Date; pageSize?: number },
): Promise<ClockifyTimeEntry[]> {
  const params = new URLSearchParams({
    start: options.start.toISOString(),
    end: options.end.toISOString(),
    "page-size": String(options.pageSize ?? 200),
  });

  return request<ClockifyTimeEntry[]>(
    `/workspaces/${workspaceId}/user/${clockifyUserId}/time-entries?${params}`,
  );
}

/** The entry a user currently has running, if any. */
export async function getRunningEntry(
  workspaceId: string,
  clockifyUserId: string,
): Promise<ClockifyTimeEntry | null> {
  const entries = await request<ClockifyTimeEntry[]>(
    `/workspaces/${workspaceId}/user/${clockifyUserId}/time-entries?in-progress=true&page-size=1`,
  );
  return entries[0] ?? null;
}

/** Everyone in the workspace — used to map Matrix users onto Clockify users. */
export function getWorkspaceUsers(
  workspaceId: string,
): Promise<ClockifyWorkspaceUser[]> {
  return request<ClockifyWorkspaceUser[]>(
    `/workspaces/${workspaceId}/users?page-size=200`,
  );
}

/** Verifies the key and workspace in one call, for the Settings test button. */
export async function verifyWorkspace(
  workspaceId: string,
): Promise<{ userCount: number }> {
  const users = await getWorkspaceUsers(workspaceId);
  return { userCount: users.length };
}
