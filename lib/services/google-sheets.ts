/**
 * Reading the linked Google Sheet that Bulk import pulls from.
 *
 * The point of this module is that it produces *text*, not events. The sheet is
 * flattened to the same tab-separated form somebody would get by selecting
 * cells and copying them, and handed to the existing importer — so the parsing,
 * the validation, the duplicate marking and the preview table are one
 * implementation rather than two that have to be kept saying the same thing.
 * A second import path is a second set of rules to drift.
 *
 * Authentication is the Drive service account. The `drive` scope it already
 * holds is accepted by the Sheets API, so linking a spreadsheet adds no
 * credential and nothing new to rotate. The service account still has to be
 * given access to the file itself — the scope is permission to ask, not
 * permission to read.
 */

import {
  accessToken,
  DriveError,
  isDriveConfigured,
  serviceAccount,
} from "./google-drive";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const TIMEOUT_MS = 20_000;

/** Above this the importer refuses anyway; stopping here avoids the round trip. */
const MAX_ROWS = 2_000;

export class SheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetError";
  }
}

/**
 * A spreadsheet ID, from whatever somebody pasted.
 *
 * People paste the whole URL far more often than the bare id, and the id is the
 * unmemorable middle of it. Accepting both costs one regex and removes the most
 * likely reason for this to be misconfigured.
 */
export function normaliseSheetId(input: string | null): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;

  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(trimmed);
  return fromUrl?.[1] ?? trimmed;
}

/**
 * Where a human opens the sheet.
 *
 * Built from the id rather than stored, so it can never point somewhere the
 * import is not actually reading from. Returns null when nothing is linked, so
 * callers render no link rather than a broken one.
 */
export function sheetUrl(sheetId: string | null): string | null {
  const id = normaliseSheetId(sheetId);
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null;
}

async function sheetsFetch(path: string): Promise<Response> {
  if (!isDriveConfigured()) {
    throw new SheetError(
      "Google is not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON on the server, then restart it.",
    );
  }

  let token: string;
  try {
    token = await accessToken();
  } catch (error) {
    throw new SheetError(
      error instanceof DriveError ? error.message : "Could not authenticate with Google.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(`${SHEETS_API}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    throw new SheetError(
      error instanceof Error && error.name === "AbortError"
        ? "Google Sheets did not respond within 20 seconds."
        : "Could not reach Google Sheets.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Turns Google's error into one that says what to do.
 *
 * 404 is the one worth spelling out: for a service account it almost always
 * means the file has not been shared with it rather than that it does not
 * exist, and Google's own wording ("Requested entity was not found") sends
 * people looking for a typo in the id instead.
 */
async function describe(response: Response, sheetId: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: string; status?: string } }
    | null;
  const message = body?.error?.message;
  const email = serviceAccount()?.client_email;
  const share = email
    ? `Share the sheet with ${email} as a Viewer, then try again.`
    : "Share the sheet with the service account's email address as a Viewer, then try again.";

  /*
   * "The API is switched off" arrives as a 403 whose message is a wall of prose
   * containing a console link. It is a completely different problem from "you
   * have not shared the file", and telling somebody to check their sharing when
   * the API was never enabled sends them round in circles — so it is detected
   * before anything else and passed through with its link intact.
   */
  if (message && /has not been used in project|is disabled/i.test(message)) {
    return `The Google Sheets API is not switched on for this project yet. Google says: ${message}`;
  }

  if (response.status === 404) {
    // The id is echoed because a mistyped one is the other likely cause — but
    // truncated, since somebody who pasted a whole console URL into the box
    // gets an unreadable wall otherwise.
    const shown = sheetId.length > 60 ? `${sheetId.slice(0, 57)}…` : sheetId;
    return `No spreadsheet with that ID is visible to the service account. ${share} (Looked for: ${shown})`;
  }
  if (response.status === 403) {
    return message ? `Google refused access: ${message}` : `Google refused access. ${share}`;
  }
  if (response.status === 400) {
    return message ?? "Google rejected the request — check the tab name.";
  }

  return message ?? `Google Sheets returned ${response.status}.`;
}

/** The tab titles in a spreadsheet, in the order they appear. */
export async function listTabs(sheetId: string): Promise<string[]> {
  const response = await sheetsFetch(
    `${encodeURIComponent(sheetId)}?fields=sheets.properties.title`,
  );

  if (!response.ok) throw new SheetError(await describe(response, sheetId));

  const body = (await response.json()) as {
    sheets?: Array<{ properties?: { title?: string } }>;
  };

  const titles =
    body.sheets
      ?.map((sheet) => sheet.properties?.title)
      .filter((title): title is string => Boolean(title)) ?? [];

  if (titles.length === 0) throw new SheetError("That spreadsheet has no tabs.");
  return titles;
}

export interface SheetRead {
  /** Rows of cells, already trimmed of wholly empty trailing rows. */
  rows: string[][];
  /** Which tab was actually read, so the UI can say. */
  tab: string;
}

/**
 * Reads one tab.
 *
 * `tab` of null means the first one — right for the single-tab schedule this is
 * built for, and wrong the moment somebody adds a "Notes" tab in front of it,
 * which is why it can be named.
 *
 * `UNFORMATTED_VALUE` is deliberately *not* used: the importer parses the same
 * human-readable text a person would paste, so what Google renders in the cell
 * is exactly what should be parsed. Asking for raw values would hand dates back
 * as serial numbers and break the very format the parser expects.
 */
export async function readSheet(
  sheetId: string,
  tab: string | null,
): Promise<SheetRead> {
  const chosen = tab?.trim() || (await listTabs(sheetId))[0]!;

  const response = await sheetsFetch(
    `${encodeURIComponent(sheetId)}/values/${encodeURIComponent(chosen)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
  );

  if (!response.ok) throw new SheetError(await describe(response, sheetId));

  const body = (await response.json()) as { values?: string[][] };
  const values = body.values ?? [];

  if (values.length === 0) {
    throw new SheetError(`The "${chosen}" tab is empty.`);
  }
  if (values.length > MAX_ROWS) {
    throw new SheetError(
      `That tab has ${values.length} rows. Read at most ${MAX_ROWS} at a time.`,
    );
  }

  return { rows: values, tab: chosen };
}

/**
 * Flattens rows into what the importer already understands.
 *
 * Tabs and newlines inside a cell would otherwise invent columns and rows that
 * nobody typed, so they collapse to spaces. Google omits trailing empty cells
 * entirely rather than padding them, so short rows are padded back out to the
 * widest — a row that ends in three blank columns must still line up with the
 * header.
 */
export function sheetToText(rows: string[][]): string {
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);

  return rows
    .map((row) => {
      const padded = Array.from({ length: width }, (_, index) => row[index] ?? "");
      return padded.map((cell) => cell.replace(/[\t\r\n]+/g, " ").trim()).join("\t");
    })
    .join("\n");
}

export interface SheetCheck {
  ok: boolean;
  message: string;
  tabs?: string[];
  /**
   * Who to share the sheet with.
   *
   * Returned whether the check passed or failed, because the moment you need it
   * is the moment it did not work — and it is otherwise buried in a
   * server-side environment variable nobody using the Settings screen can read.
   */
  serviceAccountEmail: string | null;
}

/** Proves the link works before anybody relies on it. Used by the Settings card. */
export async function checkSheetAccess(sheetId: string | null): Promise<SheetCheck> {
  const email = serviceAccount()?.client_email ?? null;
  const id = normaliseSheetId(sheetId);

  if (!id) {
    return {
      ok: false,
      message: "Enter a spreadsheet ID or URL first.",
      serviceAccountEmail: email,
    };
  }

  try {
    const tabs = await listTabs(id);
    return {
      ok: true,
      message: `Readable. ${tabs.length} tab${tabs.length === 1 ? "" : "s"}: ${tabs.join(", ")}.`,
      tabs,
      serviceAccountEmail: email,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not read that spreadsheet.",
      serviceAccountEmail: email,
    };
  }
}
