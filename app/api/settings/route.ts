import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { getSettings, updateSettings } from "@/lib/services/settings";
import { updateSettingsSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Readable by everyone — the UI needs the theme default and site name. */
export async function GET() {
  return handle(async () => {
    await requireUser();
    return jsonOk({ settings: await getSettings() });
  });
}

export async function PATCH(request: NextRequest) {
  return handle(async () => {
    const actor = await requireAdmin();
    const input = updateSettingsSchema.parse(await readJson(request));
    return jsonOk({ settings: await updateSettings(input, actor.real.id) });
  });
}
