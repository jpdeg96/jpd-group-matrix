import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth/guards";
import {
  listNotifications,
  notificationSignature,
} from "@/lib/services/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long one connection lives before the browser reconnects. */
const STREAM_LIFETIME_MS = 50_000;
const POLL_INTERVAL_MS = 3_000;

/**
 * Live notifications for the signed-in person.
 *
 * A separate stream from presence rather than another event on that one,
 * because presence is per-screen and this is per-person: the presence stream is
 * opened by the Dashboard and C1 tables and torn down when you navigate away,
 * while the bell lives in the shell and has to keep working on Settings and
 * Metrics. Carrying this on that connection would mean the bell went quiet
 * exactly where there is no table to look at instead.
 *
 * Scoped to the session with no recipient parameter, so there is no request
 * shape that subscribes to somebody else's bell.
 *
 * Frames are sent only when the ids or their read state actually change, so an
 * account with nothing happening costs one keep-alive comment every three
 * seconds and no database round trip beyond the signature.
 */
export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requireActor();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      let lastSignature: string | null = null;

      const tick = async () => {
        if (closed) return;
        try {
          const signature = await notificationSignature(actor);

          if (signature !== lastSignature) {
            // Sent on the first tick of every connection, not only on change.
            // This stream closes every ~50s by design and the browser
            // reconnects; a server that only spoke on change would go silent
            // about anything that happened across that gap.
            lastSignature = signature;
            send("notifications", await listNotifications(actor));
            return;
          }

          if (!closed) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          }
        } catch (error) {
          console.error("[notification-stream] poll failed", error);
        }
      };

      await tick();
      timer = setInterval(tick, POLL_INTERVAL_MS);

      const shutdown = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      setTimeout(shutdown, STREAM_LIFETIME_MS);
      request.signal.addEventListener("abort", shutdown);
    },

    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
