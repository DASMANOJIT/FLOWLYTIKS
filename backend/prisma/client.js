// backend/prisma/client.js
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__flowlytiksPrisma ??
  new PrismaClient({
    log: process.env.DEBUG_DB === "1" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__flowlytiksPrisma = prisma;
}

export default prisma;
