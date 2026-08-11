import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { createEventType, listEventTypes } from "@/lib/services/event-types";
import { createEventTypeSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await requireUser();
    return jsonOk({ types: await listEventTypes() });
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireAdmin();
    const input = createEventTypeSchema.parse(await readJson(request));
    return jsonOk(
      { type: await createEventType(input, actor.real.id) },
      { status: 201 },
    );
  });
}
