/**
 * Long-running scheduler for self-hosted deployments.
 *
 *   npm run scheduler
 *
 * Fires the maintenance routine at 6:05 AM America/Chicago by default. The
 * timezone is handed to node-cron by name, so the job stays at 6:05 local time
 * across the CST/CDT changeover — an offset is never hard-coded anywhere.
 *
 * On Vercel this script is not used: `vercel.json` schedules the maintenance
 * endpoint hourly instead, because Vercel Cron only understands UTC. The
 * routine is idempotent, so running it 24 times a day is equivalent to running
 * it once, and it can never miss a day due to a DST shift.
 *
 * The scheduler talks to the application over HTTP when MAINTENANCE_URL is set,
 * so it works against a separately deployed instance; otherwise it calls the
 * service directly.
 */

import "dotenv/config";
import cron from "node-cron";

const expression = process.env.MAINTENANCE_CRON ?? "5 6 * * *";
const timezone = process.env.MAINTENANCE_CRON_TIMEZONE ?? "America/Chicago";
const maintenanceUrl = process.env.MAINTENANCE_URL;
const cronSecret = process.env.CRON_SECRET;

if (!cron.validate(expression)) {
  console.error(`[scheduler] invalid cron expression: "${expression}"`);
  process.exit(1);
}

async function runOnce(): Promise<void> {
  const startedAt = new Date();
  console.info(`[scheduler] maintenance starting at ${startedAt.toISOString()}`);

  try {
    if (maintenanceUrl) {
      if (!cronSecret) {
        throw new Error(
          "CRON_SECRET must be set to call the maintenance endpoint over HTTP.",
        );
      }

      const response = await fetch(maintenanceUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${cronSecret}` },
      });

      if (!response.ok) {
        throw new Error(
          `maintenance endpoint returned ${response.status} ${response.statusText}`,
        );
      }

      console.info("[scheduler] maintenance complete", await response.json());
    } else {
      // Imported lazily so the HTTP path does not need a database connection.
      const { runMaintenance } = await import("../lib/services/maintenance");
      console.info("[scheduler] maintenance complete", await runMaintenance());
    }
  } catch (error) {
    // Never rethrow: an exception here would kill the scheduler process and
    // silently stop all future runs.
    console.error("[scheduler] maintenance failed", error);
  }
}

cron.schedule(expression, runOnce, { timezone });

console.info(
  `[scheduler] started — "${expression}" in ${timezone}` +
    (maintenanceUrl ? ` → POST ${maintenanceUrl}` : " → direct database call"),
);

// Run once at boot so a restart does not skip a scheduled window.
void runOnce();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.info(`[scheduler] received ${signal}, shutting down`);
    process.exit(0);
  });
}
