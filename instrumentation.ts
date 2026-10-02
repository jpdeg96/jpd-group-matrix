/**
 * Server startup hook.
 *
 * Next.js calls `register` once per server process, which is the only place
 * this application has to start something that must run whether or not anybody
 * has a page open.
 */

export async function register(): Promise<void> {
  // Also called for the edge runtime, where there is no timer worth starting
  // and no database client to use.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Skipped during `next build`: the build runs this file to collect metadata,
  // and a build machine polling a live Clockify workspace would announce
  // transitions to everybody from a process that is about to exit.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { startClockWatchLoop } = await import("./lib/services/clock-watch-loop");
  startClockWatchLoop();
}
