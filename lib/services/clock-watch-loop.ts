/**
 * The timer that drives the clock poller.
 *
 * Started once per server process from `instrumentation.ts`. It lives in the
 * web server rather than in its own worker because that is one moving part
 * instead of two, and the work is a handful of HTTP calls a minute — nothing
 * that needs its own machine.
 *
 * ## Why this calls an endpoint instead of the service
 *
 * Reaching `runClockWatch` directly would pull `web-push` into the module graph
 * of `instrumentation.ts`, which Next compiles for every runtime — including
 * ones with no `http` module for https-proxy-agent to require. That is a
 * build-time resolution failure, and it is not contained to this feature: it
 * takes down every route in the application with a 500.
 *
 * Going over the loopback keeps this file's imports to nothing but Node's own,
 * and has a second benefit worth more than the indirection costs: a self-hosted
 * timer and an external scheduler now drive exactly the same code path, so
 * there is one thing to test rather than two that can drift.
 */

/**
 * How often to ask Clockify.
 *
 * This is also the worst-case notification delay: somebody clocking in just
 * after a tick is announced on the next one. A minute is well inside what
 * "they just started" means to a person reading it, and costs one request per
 * linked user per minute — a few hundred a day for this team, against a
 * Clockify limit measured per second.
 */
const INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

function selfUrl(): string {
  // Render and most hosts set PORT; nothing else here depends on the public
  // hostname, and loopback avoids a round trip through the load balancer.
  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}/api/internal/clock-watch`;
}

async function tick(secret: string): Promise<void> {
  // Never overlap with itself. A slow Clockify can make a tick outlast the
  // interval, and two concurrent polls would race on the same status rows.
  if (running) return;
  running = true;

  try {
    const response = await fetch(selfUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });

    if (!response.ok) {
      console.error(`[clock-watch] poll returned ${response.status}`);
    }
  } catch (error) {
    // Never rethrow: an unhandled rejection here would take down the timer and
    // silently stop every future poll — the one failure nobody would notice
    // until they asked why they had stopped being told.
    console.error("[clock-watch] poll failed", error);
  } finally {
    running = false;
  }
}

export function startClockWatchLoop(): void {
  if (timer) return;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Deliberately not falling back to an unauthenticated call. The endpoint
    // refuses the bearer path entirely without a configured secret, and an
    // internal job that quietly runs without authentication is how one ends up
    // reachable from outside.
    console.warn(
      "[clock-watch] CRON_SECRET is not set — clock notifications are off. " +
        "Set it to enable them, or drive /api/internal/clock-watch externally.",
    );
    return;
  }

  timer = setInterval(() => void tick(secret), INTERVAL_MS);

  // Do not hold the process open on its own account: without this a graceful
  // shutdown waits out the interval.
  timer.unref?.();

  console.info(`[clock-watch] polling every ${INTERVAL_MS / 1000}s`);

  // Not on boot. The first poll after a restart has no stored state to compare
  // against for anybody new, and running it during the noisiest moment of a
  // deploy buys nothing. The first tick is a minute away.

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      if (timer) clearInterval(timer);
    });
  }
}
