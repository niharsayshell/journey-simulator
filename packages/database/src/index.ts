import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

/** Shared Prisma client (one per process). */
export const prisma: PrismaClient =
  globalForPrisma.__prisma ??
  new PrismaClient({ log: process.env.PRISMA_LOG_QUERIES === "1" ? ["query", "warn", "error"] : ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = prisma;
