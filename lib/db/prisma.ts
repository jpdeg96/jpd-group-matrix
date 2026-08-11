import { PrismaClient, type Prisma } from "@prisma/client";

/**
 * Prisma singleton.
 *
 * Next.js dev-mode hot reload re-evaluates modules on every edit; without the
 * global cache each reload would open a fresh connection pool until Postgres
 * refuses new connections.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Transaction-client type. Services accept this so they compose inside
 * `$transaction` — the full `PrismaClient` is assignable to it, so the same
 * function works both inside and outside a transaction.
 */
export type PrismaTransactionClient = Prisma.TransactionClient;
