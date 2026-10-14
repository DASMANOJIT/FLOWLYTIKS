import "./setupDisposableDatabase.js";
import prisma from "../prisma/client.js";
import { withPgTransactionLock } from "../utils/dbLocks.js";

process.send({ ready: true });
process.once("message", async ({ key }) => {
  try {
    const results = [];
    for (let i = 0; i < 15; i++) {
      let result;
      do {
        result = await withPgTransactionLock(prisma, key, async tx => {
          const count = await tx.authRateLimitEvent.count({ where: { namespace: key } });
          if (count >= 7) return "limited";
          await tx.authRateLimitEvent.create({ data: { namespace: key, key } });
          return "accepted";
        }, { onLocked: () => "retry" });
        if (result === "retry") await new Promise(resolve => setTimeout(resolve, 10));
      } while (result === "retry");
      results.push(result);
    }
    await prisma.$disconnect();
    process.send({ results });
    process.disconnect();
  } catch (error) {
    console.error("transaction-lock test worker failed", { code: error.code, name: error.name });
    await prisma.$disconnect();
    process.exitCode = 1;
    process.disconnect();
  }
});
