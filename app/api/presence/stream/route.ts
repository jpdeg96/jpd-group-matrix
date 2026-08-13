import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { listPresenceFlat, presenceSignature } from "@/lib/services/presence";
import { getRevisionToken } from "@/lib/services/data-revision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long one connection lives before the browser reconnects. */
const STREAM_LIFETIME_MS = 50_000;
const POLL_INTERVAL_MS = 2_000;

/**
 * Server-Sent Events stream of who is working on what.
 *
 * SSE rather than WebSockets: this is one-directional (the server tells
 * everyone what changed; clients push updates over ordinary POSTs), and
 * EventSource reconnects on its own, which matters on hosts that cap how long a
 * response may stay open.
 *
 * The connection deliberately closes after ~50s and lets the browser
 * re-establish it. Serverless platforms terminate long responses anyway, and a
 * predictable reconnect is far easier to reason about than an unpredictable
 * truncation. Clients that cannot use SSE at all fall back to polling
 * `GET /api/presence`.
 *
 * Payloads are only sent when the set of (event, user) pairs actually changes,
 * so an idle team generates no traffic beyond a keep-alive comment.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const context =
    request.nextUrl.searchParams.get("context") === "C1" ? "C1" : "DASHBOARD";

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
          // The client went away between our check and the write.
          closed = true;
        }
      };

      let lastSignature = "";
      let lastRevision = "";

      const tick = async () => {
        if (closed) return;
        try {
          const [entries, revision] = await Promise.all([
            listPresenceFlat(context),
            getRevisionToken(),
          ]);

          const signature = presenceSignature(entries);
          let sentSomething = false;

          if (signature !== lastSignature) {
            lastSignature = signature;
            send("presence", { presence: entries });
            sentSomething = true;
          }

          // Carried on this connection rather than a second one: it is already
          // open, already on a timer, and a browser only gets a handful of
          // EventSource connections per origin before it starts queueing them.
          //
          // Sent on the first tick of every connection, not only on change.
          // This stream closes every ~50s by design and the browser reconnects,
          // so a server that only spoke up on change would go silent about
          // anything that happened across that gap — the client would sit on
          // stale data until the *next* unrelated edit. Deciding what counts as
          // new is the client's job; it is the one that knows what it last saw.
          if (revision !== lastRevision) {
            lastRevision = revision;
            send("revision", { revision });
            sentSomething = true;
          }

          // Keep-alive comment: stops proxies closing an idle connection
          // without counting as a data frame.
          if (!sentSomething && !closed) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          }
        } catch (error) {
          console.error("[presence-stream] poll failed", error);
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

      // Close on schedule; EventSource reconnects automatically.
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
      // Stops nginx-style proxies buffering the stream into uselessness.
      "X-Accel-Buffering": "no",
    },
  });
}
