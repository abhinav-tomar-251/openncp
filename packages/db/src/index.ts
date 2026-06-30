import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

/**
 * Singleton PrismaClient. Reused across hot-reloads in dev so we don't exhaust
 * Postgres connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
