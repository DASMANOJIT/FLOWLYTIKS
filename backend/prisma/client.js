// backend/prisma/client.js
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

const queryMetricsEnabled = process.env.DB_QUERY_METRICS === "1";

const prisma =
  globalForPrisma.__flowlytiksPrisma ??
  new PrismaClient({
    log: queryMetricsEnabled
      ? [
          { emit: "event", level: "query" },
          ...(process.env.DEBUG_DB === "1" ? ["warn", "error"] : ["error"]),
        ]
      : process.env.DEBUG_DB === "1"
        ? ["warn", "error"]
        : ["error"],
  });

if (queryMetricsEnabled) {
  prisma.$on("query", (event) => {
    console.log(
      `[db.query] duration=${event.duration}ms query=${event.query}`,
    );
  });
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__flowlytiksPrisma = prisma;
}

export default prisma;
