/**
 * One-shot maintenance run.
 *
 *   npm run maintenance
 *
 * Calls the same `runMaintenance()` the HTTP endpoint and the scheduler use,
 * straight against the database. Useful for cron/systemd on a host that would
 * rather not make an HTTP call, and for checking slippage locally.
 */

import "dotenv/config";
import { runMaintenance } from "../lib/services/maintenance";
import { prisma } from "../lib/db/prisma";

async function main() {
  const result = await runMaintenance();

  console.log("JPD Group Matrix — maintenance");
  console.log("──────────────────────────────");
  console.log(`Business date:              ${result.today}`);
  console.log(`Stale in-progress cleared:   ${result.presenceCleared}`);
  console.log(`Past events archived:        ${result.eventsArchived}`);
  console.log(`Overdue C1 stages:           ${result.overdueStages}`);
  console.log(`Duration:                    ${result.durationMs}ms`);

  if (result.overdueStages > 0) {
    console.log(
      "\nNote: overdue stages are reported, never auto-completed. That count " +
        "is work that has slipped and needs a person.",
    );
  }
}

main()
  .catch((error) => {
    console.error("[maintenance] run failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
