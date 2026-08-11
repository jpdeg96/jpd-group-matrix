import { defineConfig } from "vitest/config";
import dotenv from "dotenv";
import path from "node:path";

/**
 * Integration-test configuration — requires a real PostgreSQL database.
 *
 *   npm run db:deploy
 *   npm run test:integration
 *
 * DESTRUCTIVE: these tests truncate events, review tasks, users and audit logs.
 * They therefore run against `TEST_DATABASE_URL` when it is set, so a stray run
 * cannot wipe the database you have been clicking around in. Falls back to
 * DATABASE_URL only if no scratch database is configured.
 */
dotenv.config();

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn(
    "\n[integration] Neither TEST_DATABASE_URL nor DATABASE_URL is set — the suite will skip.\n",
  );
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // One shared database, truncated between tests: files must not overlap.
    fileParallelism: false,
    // Real round trips, plus deliberate sleeps where a test needs two distinct
    // completion timestamps.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      // Same non-Central timezone as the unit suite: business dates must still
      // resolve to America/Chicago regardless of the host.
      TZ: "Pacific/Kiritimati",
      ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
