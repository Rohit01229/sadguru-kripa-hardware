// Single source of truth for DB access. Only @hardware/core imports this (03 §1).
export * from "@prisma/client"; // PrismaClient, Prisma (Decimal, sql), enums, model types
export { prisma } from "./client";
