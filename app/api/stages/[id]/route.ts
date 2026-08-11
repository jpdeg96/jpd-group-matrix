import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import { updateStage } from "@/lib/services/stages";
import { updateStageSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Updates the review stage currently shown for a C1 row.
 *
 * Ticking `done` resolves this stage; the row then re-renders as the next
 * pending one. When none remain the event leaves C1.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await params;
    const input = updateStageSchema.parse(await readJson(request));
    return jsonOk(await updateStage(id, input, actor));
  });
}
