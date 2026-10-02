/**
 * A short, renewable claim on a job only one process may run.
 *
 * The clock poller lives inside the web server rather than as its own service,
 * which is simple and right for one instance and silently wrong for two: both
 * would poll Clockify, both would see the same clock-in, and everybody would be
 * told twice. Whoever holds the lease polls; everybody else skips the tick.
 *
 * Expiry rather than an explicit release, so a process killed mid-tick does not
 * hold the job shut until somebody notices. The cost of that choice is that a
 * very slow tick can have its lease expire underneath it and let a second
 * process start — which is why the lease is held for several times the expected
 * tick, and why the work it guards is safe to run twice anyway (the clock
 * poller writes what it saw and notifies on a change, so a duplicate run sees
 * no change and does nothing).
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";

/** Identifies this process in the lease table. Survives for its lifetime. */
const HOLDER = `${process.pid}:${randomUUID().slice(0, 8)}`;

export function leaseHolderId(): string {
  return HOLDER;
}

/**
 * Take the lease, or find out somebody else has it.
 *
 * One statement, so two processes racing cannot both win: the update only
 * matches a row that has expired, and Postgres serialises the two attempts.
 */
export async function acquireLease(
  name: string,
  ttlMs: number,
): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  // Claim an expired or unheld lease, or extend one this process already holds.
  const claimed = await prisma.$executeRaw`
    INSERT INTO "system_leases" ("name", "holder", "expires_at")
    VALUES (${name}, ${HOLDER}, ${expiresAt})
    ON CONFLICT ("name") DO UPDATE
      SET "holder" = ${HOLDER}, "expires_at" = ${expiresAt}
      WHERE "system_leases"."expires_at" < ${now}
         OR "system_leases"."holder" = ${HOLDER}
  `;

  return claimed > 0;
}

/**
 * Give it up early.
 *
 * Only ever a courtesy — the expiry is what makes the lease safe. Used on a
 * clean shutdown so a restart does not have to wait out the TTL.
 */
export async function releaseLease(name: string): Promise<void> {
  await prisma.systemLease
    .deleteMany({ where: { name, holder: HOLDER } })
    .catch(() => undefined);
}
