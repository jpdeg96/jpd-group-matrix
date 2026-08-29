import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireManager } from "@/lib/auth/guards";
import { commitImport, previewImport } from "@/lib/services/import";
import { readSheet, sheetToText, sheetUrl, SheetError } from "@/lib/services/google-sheets";
import { getSettings } from "@/lib/services/settings";
import { validationError } from "@/lib/errors";
import { importSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reads the linked spreadsheet and flattens it to the same text a paste would
 * produce, so both sources meet the one parser.
 *
 * Read on both the preview and the commit rather than carried between them.
 * That means a sheet edited in between is caught — the commit acts on what the
 * sheet says now, and the counts in the result are the truth about what was
 * written rather than a promise made a minute ago.
 */
async function textFromSheet(): Promise<{ text: string; tab: string; url: string | null }> {
  const settings = await getSettings();

  if (!settings.importSheetId) {
    throw validationError(
      "No spreadsheet is linked. An administrator can add one under Settings → Integrations.",
    );
  }

  const { rows, tab } = await readSheet(settings.importSheetId, settings.importSheetTab);
  return { text: sheetToText(rows), tab, url: sheetUrl(settings.importSheetId) };
}

/**
 * Bulk import, in two phases, from either source.
 *
 * `commit: false` parses and validates without writing anything, which is what
 * the preview table renders. `commit: true` writes only the rows that parsed
 * cleanly. The user always sees the parse result before anything is created.
 *
 * Manager or above: a bad import is disproportionately expensive to unpick.
 */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireManager();
    const input = importSchema.parse(await readJson(request));

    let text: string;
    let sheet: { tab: string; url: string | null } | null = null;

    if (input.source === "SHEET") {
      try {
        const read = await textFromSheet();
        text = read.text;
        sheet = { tab: read.tab, url: read.url };
      } catch (error) {
        // Google's failures are configuration problems with a fix, so they are
        // surfaced as validation rather than a 500 the user can do nothing with.
        if (error instanceof SheetError) throw validationError(error.message);
        throw error;
      }
    } else {
      text = input.text;
    }

    if (!input.commit) {
      return jsonOk({ preview: await previewImport(text), sheet });
    }

    return jsonOk({ result: await commitImport(text, actor), sheet });
  });
}
