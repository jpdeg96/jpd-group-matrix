import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Unit-test configuration — pure domain, date and validation logic.
 *
 * Deliberately excludes tests/integration: that suite imports the Prisma
 * client at module load, which requires a generated client and a reachable
 * DATABASE_URL. Keeping the two configs separate means `npm test` always works,
 * even on a machine with no database, and never fails for reasons unrelated to
 * the business rules being tested.
 *
 * Run the database-backed suite with `npm run test:integration`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // Force a timezone that is neither UTC nor Central. Every business rule must
    // still produce America/Chicago answers. A test that only passes because
    // the machine happens to sit in Central Time is a broken test.
    env: {
      TZ: "Pacific/Kiritimati",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
