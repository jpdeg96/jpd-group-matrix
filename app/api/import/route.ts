import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireManager } from "@/lib/auth/guards";
import { commitImport, previewImport } from "@/lib/services/import";
import { importSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Bulk import, in two phases.
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
    const { text, commit } = importSchema.parse(await readJson(request));

    if (!commit) {
      return jsonOk({ preview: await previewImport(text) });
    }

    return jsonOk({ result: await commitImport(text, actor) });
  });
}
