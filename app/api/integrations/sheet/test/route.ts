import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/guards";
import { checkSheetAccess } from "@/lib/services/google-sheets";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  /** Whatever is in the box right now — the id or the whole URL. */
  sheetId: z.string().trim().max(300).nullable(),
});

/**
 * Proves the link works before anybody relies on it.
 *
 * Tests what is currently typed rather than what is saved, so the answer is
 * about the value being considered rather than the last one that happened to
 * stick. Reports the tab names on success, which is the quickest way to see
 * that it reached the right spreadsheet and not merely *a* spreadsheet.
 */
export async function POST(request: NextRequest) {
  return handle(async () => {
    await requireAdmin();
    const { sheetId } = schema.parse(await readJson(request));
    return jsonOk(await checkSheetAccess(sheetId));
  });
}
