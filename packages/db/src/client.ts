import { PrismaClient } from "@prisma/client";

// Singleton Prisma client. On serverless, Neon's pooled connection string
// (DATABASE_URL) avoids exhausting Postgres connections; migrations use DIRECT_URL.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
