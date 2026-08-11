import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import { createEvent, listDashboardEvents } from "@/lib/services/events";
import {
  createEventSchema,
  dashboardQuerySchema,
  searchParamsToObject,
} from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handle(async () => {
    await requireUser();

    const filters = dashboardQuerySchema.parse(
      searchParamsToObject(request.nextUrl.searchParams),
    );

    return jsonOk({ events: await listDashboardEvents(filters) });
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireUser();
    const input = createEventSchema.parse(await readJson(request));
    return jsonOk({ event: await createEvent(input, actor) }, { status: 201 });
  });
}
