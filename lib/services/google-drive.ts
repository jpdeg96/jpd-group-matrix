/**
 * Uploads invoice PDFs to a Google Drive folder, as a service account.
 *
 * ## Why there is no googleapis dependency
 *
 * The whole of what this needs is: sign a JWT, exchange it for an access token,
 * and POST a multipart body. That is the hundred lines below. `googleapis`
 * pulls in a very large tree to do the same thing, and this codebase has
 * already taken the same view for spreadsheets, Clockify and email.
 *
 * ## Auth
 *
 * A service account, not OAuth-as-a-user. There is no consent screen, nothing
 * expires, and no refresh token dies when somebody changes their password.
 * The trade is that a service account has no Drive storage of its own, so the
 * destination folder is created by a human and shared with the service
 * account's address — exactly as you would share it with a colleague.
 *
 * ## Why the scope is `drive` and not `drive.file`
 *
 * `drive.file` sounds like the least-privilege choice and is the wrong one
 * here. It grants access to files *the application itself created* — a folder
 * a person made and then shared is not one of those, so it stays invisible
 * however it is shared. That produces a 404 on a folder sitting right there
 * with Editor permission granted, which is a genuinely confusing failure.
 *
 * `drive` is not the escalation it looks like *for a service account*. A
 * service account has its own empty Drive and can see nothing except what has
 * been explicitly shared with it, so the sharing is the real boundary and the
 * scope is not. Widening it grants reach over exactly one folder: the one you
 * shared.
 *
 * The distinction matters because `drive.file` exists to protect a *human*
 * user's existing files during an OAuth consent flow. There is no such library
 * to protect here.
 *
 * The key lives in `GOOGLE_SERVICE_ACCOUNT_JSON` — the downloaded JSON, whole,
 * as one environment variable. It never touches the database.
 */

import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const SCOPE = "https://www.googleapis.com/auth/drive";
const TIMEOUT_MS = 20_000;

export class DriveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriveError";
  }
}

/** The shape Drive returns on failure. */
interface DriveApiError {
  error?: {
    message?: string;
    errors?: { reason?: string; message?: string }[];
  };
}

/**
 * Turns a Drive failure into something worth reading.
 *
 * Google's own message is kept rather than replaced. An earlier version of this
 * substituted a guess — "the folder is probably not shared" — which was
 * confidently wrong in the one case that actually matters, and hid the reason
 * code that would have said so. Guesses are only added *around* Google's text,
 * never instead of it.
 */
export function describeDriveError(status: number, body: DriveApiError | null): string {
  const reason = body?.error?.errors?.[0]?.reason ?? "";
  const message = body?.error?.message ?? "";

  // The one that catches everybody. Google stopped letting service accounts own
  // files in My Drive: they have no storage quota, so a folder shared from a
  // personal Drive can be read perfectly and never written to. A Shared Drive
  // owns its own files, which is what makes it work.
  if (reason === "storageQuotaExceeded" || /storage quota/i.test(message)) {
    return (
      "A service account cannot own files in an ordinary Drive folder — Google gives them no " +
      "storage of their own, which is why reading the folder works and writing to it does not. " +
      "Move the folder into a Shared Drive and add the service account as a member with " +
      "Content manager access, then use the new folder ID."
    );
  }

  if (reason === "insufficientFilePermissions" || /permission/i.test(message)) {
    return (
      "The service account can see the folder but cannot write to it. It has probably been " +
      `shared as Viewer or Commenter rather than Editor. (Drive said: ${message})`
    );
  }

  if (reason === "accessNotConfigured" || /has not been used|is disabled/i.test(message)) {
    return `The Drive API is not enabled on that Google Cloud project. (Drive said: ${message})`;
  }

  return message
    ? `Drive returned ${status}: ${message}`
    : `Drive returned ${status} with no explanation.`;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/**
 * The parsed key, or null when not configured.
 *
 * Render's dashboard turns a pasted newline into a literal `\n`, which is the
 * single most common way this is set up wrong — so that is repaired rather than
 * left to fail later with an opaque signature error.
 */
export function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DriveError(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the downloaded key file whole, including the outermost braces.",
    );
  }

  const account = parsed as Partial<ServiceAccount>;
  if (!account.client_email || !account.private_key) {
    throw new DriveError(
      "GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key. That is usually an OAuth client file rather than a service-account key.",
    );
  }

  return {
    client_email: account.client_email,
    private_key: account.private_key.replace(/\\n/g, "\n"),
  };
}

export function isDriveConfigured(): boolean {
  try {
    return serviceAccount() !== null;
  } catch {
    // Present but malformed still counts as "configured" — the administrator
    // meant to turn this on, and saying "not configured" would send them
    // looking in the wrong place.
    return true;
  }
}

const base64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64url");

/** Cached until shortly before it expires; tokens last an hour. */
let cached: { token: string; expiresAt: number } | null = null;

/** Exported for tests: the claim set that gets signed. */
export function buildJwtClaims(clientEmail: string, now: number) {
  return {
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
}

async function accessToken(): Promise<string> {
  const account = serviceAccount();
  if (!account) {
    throw new DriveError(
      "Google Drive is not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON on the server, then restart it.",
    );
  }

  // A minute of headroom, so a token is never used in the second it dies.
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify(buildJwtClaims(account.client_email, now)));

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);

  let signature: string;
  try {
    signature = signer.sign(account.private_key, "base64url");
  } catch {
    throw new DriveError(
      "Could not sign with the service-account private key. It is probably truncated — check the whole BEGIN/END block survived being pasted.",
    );
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cache: "no-store",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });

  const body = (await response.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error_description?: string; error?: string }
    | null;

  if (!response.ok || !body?.access_token) {
    throw new DriveError(
      body?.error_description ??
        body?.error ??
        `Google refused the service-account key (${response.status}).`,
    );
  }

  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };

  return cached.token;
}

/** Dropped when the key is rotated, so the next call re-authenticates. */
export function resetDriveToken(): void {
  cached = null;
}

export interface UploadResult {
  fileId: string;
  /** Opens the file in Drive's own viewer. */
  webViewLink: string;
}

/**
 * A `multipart/related` body: JSON metadata, then the file bytes.
 *
 * Exported so it can be tested. Every rule here is one Drive rejects the whole
 * upload over — CRLF rather than LF, a blank line after each part's headers,
 * and the closing delimiter carrying trailing dashes — and none of them are
 * visible in a wrong-looking way if you get them wrong.
 *
 * Assembled through Buffer rather than a string because the PDF is binary: a
 * template literal would put it through UTF-8 encoding and corrupt it.
 */
export function buildMultipartBody(
  metadata: object,
  bytes: Buffer,
  boundary: string,
): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

/**
 * Uploads one PDF into `folderId`, replacing any file of the same name.
 *
 * Replacing rather than versioning is deliberate: a reissued invoice keeps its
 * number, and two files called `JPD-20260810.pdf` in one folder is exactly the
 * ambiguity the invoice numbering exists to prevent.
 */
export async function uploadPdf(input: {
  folderId: string;
  filename: string;
  bytes: Buffer;
}): Promise<UploadResult> {
  const token = await accessToken();

  const existingId = await findByName(token, input.folderId, input.filename);

  const metadata = existingId
    ? { name: input.filename }
    : { name: input.filename, parents: [input.folderId], mimeType: "application/pdf" };

  const boundary = `matrix-${Date.now().toString(36)}`;
  const body = buildMultipartBody(metadata, input.bytes, boundary);

  const url = new URL(existingId ? `${UPLOAD_URL}/${existingId}` : UPLOAD_URL);
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,webViewLink");
  // Shared drives are a different storage model and the API ignores the parent
  // without this. Harmless on an ordinary folder.
  url.searchParams.set("supportsAllDrives", "true");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: existingId ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      signal: controller.signal,
      cache: "no-store",
      body: new Uint8Array(body),
    });

    const result = (await response.json().catch(() => null)) as
      | ({ id?: string; webViewLink?: string } & DriveApiError)
      | null;

    if (!response.ok || !result?.id) {
      throw new DriveError(
        response.status === 404
          ? "Drive could not find that folder. Check the folder ID, and that the folder is shared with the service account's email address as an Editor."
          : describeDriveError(response.status, result),
      );
    }

    return {
      fileId: result.id,
      webViewLink: result.webViewLink ?? `https://drive.google.com/file/d/${result.id}/view`,
    };
  } catch (error) {
    if (error instanceof DriveError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new DriveError("Drive did not respond in time.");
    }
    throw new DriveError("Could not reach Google Drive.");
  } finally {
    clearTimeout(timer);
  }
}

/** The id of a file of this name already in the folder, if there is one. */
async function findByName(
  token: string,
  folderId: string,
  filename: string,
): Promise<string | null> {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  // Single quotes delimit the literal in Drive's query language, so one inside
  // the name would end it early. Escaping is what stops a filename breaking
  // the query.
  const escaped = filename.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  url.searchParams.set("q", `name = '${escaped}' and '${folderId}' in parents and trashed = false`);
  url.searchParams.set("fields", "files(id)");
  url.searchParams.set("pageSize", "1");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const body = (await response.json().catch(() => null)) as { files?: { id: string }[] } | null;
  return body?.files?.[0]?.id ?? null;
}

/**
 * Proves the whole chain works: sign, exchange, reach the folder, and — the
 * part that actually matters — write to it.
 *
 * An earlier version only read the folder's metadata. That passes with Viewer
 * permission, and passes when the account has no storage quota to write with,
 * so it reported success on a configuration that could not file a single
 * invoice. A check that cannot fail the way the real thing fails is worse than
 * no check, because it is believed.
 *
 * So it writes a small file and deletes it again. Pressing this repeatedly
 * leaves nothing behind; if the delete is the thing that fails, the file is
 * named clearly enough to remove by hand.
 */
export async function checkDriveAccess(
  folderId: string,
): Promise<{ folderName: string; serviceAccountEmail: string }> {
  const token = await accessToken();
  const email = serviceAccount()?.client_email ?? "(unknown)";

  const url = new URL(`https://www.googleapis.com/drive/v3/files/${folderId}`);
  url.searchParams.set("fields", "id,name,mimeType");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const body = (await response.json().catch(() => null)) as
    | { name?: string; mimeType?: string; error?: { message?: string } }
    | null;

  if (!response.ok) {
    if (response.status === 404) {
      // "Share it with the service account" is useless advice without saying
      // which address, and a mistyped or wrong address is the likeliest cause
      // once the scope is right. Listing what it *can* see turns a guess into
      // an observation: an empty list means the share never landed on this
      // account, and a non-empty one means the folder id is wrong.
      const visible = await listVisibleFolders(token);
      throw new DriveError(
        `No folder with that ID is visible to ${email}. ` +
          (visible.length === 0
            ? "That account currently sees nothing at all, so the share has not reached it — check the address you shared with matches exactly."
            : `It can currently see: ${visible.join(", ")}. Copy the ID of the folder you want from its URL.`),
      );
    }

    throw new DriveError(body?.error?.message ?? `Drive returned ${response.status}.`);
  }

  if (body?.mimeType !== "application/vnd.google-apps.folder") {
    throw new DriveError("That ID is a file, not a folder. Open the folder and copy the ID from its URL.");
  }

  await probeWrite(token, folderId);

  return { folderName: body?.name ?? "(unnamed)", serviceAccountEmail: email };
}

/** Writes a tiny file and removes it. Throws with the real reason if it cannot. */
async function probeWrite(token: string, folderId: string): Promise<void> {
  const boundary = `matrix-probe-${Date.now().toString(36)}`;
  const body = buildMultipartBody(
    { name: "matrix-write-test.txt", parents: [folderId], mimeType: "text/plain" },
    Buffer.from("Written by JPD Group Matrix to confirm access. Safe to delete."),
    boundary,
  );

  const url = new URL(UPLOAD_URL);
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    cache: "no-store",
    body: new Uint8Array(body),
  });

  const result = (await response.json().catch(() => null)) as
    | ({ id?: string } & DriveApiError)
    | null;

  if (!response.ok || !result?.id) {
    throw new DriveError(describeDriveError(response.status, result));
  }

  // Best-effort tidy-up. A leftover probe file is untidy, not broken, and
  // failing the test over it would report the wrong problem.
  const deleteUrl = new URL(`https://www.googleapis.com/drive/v3/files/${result.id}`);
  deleteUrl.searchParams.set("supportsAllDrives", "true");
  await fetch(deleteUrl, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => undefined);
}

/** Folder names the service account can see at all. Diagnostic only. */
async function listVisibleFolders(token: string): Promise<string[]> {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set(
    "q",
    "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
  );
  url.searchParams.set("fields", "files(name)");
  url.searchParams.set("pageSize", "10");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!response.ok) return [];

  const body = (await response.json().catch(() => null)) as { files?: { name: string }[] } | null;
  return (body?.files ?? []).map((file) => `"${file.name}"`);
}
