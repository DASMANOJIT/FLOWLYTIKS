import "./setupDisposableDatabase.js";
import db from "../prisma/client.js";
import { reserveCashfreeCheckout } from "../services/cashfreeCheckoutService.js";
import { processPendingBackgroundJobs } from "../services/backgroundJobService.js";
process.send({ ready: true });
process.once("message", async message => {
  try {
    if (message.kind === "checkout") {
      const result = await reserveCashfreeCheckout(db, message.details);
      process.send({ result });
    } else {
      const count = await processPendingBackgroundJobs({ db, jobId: message.jobId, maxJobs: 1, execute: async job => {
        await db.authRateLimitEvent.create({ data: { namespace: message.key, key: job.id } });
        await new Promise(resolve => setTimeout(resolve, 150));
        return { processedItems: 1 };
      } });
      process.send({ result: { count } });
    }
    await db.$disconnect(); process.disconnect();
  } catch (error) { console.error("isolated lock worker failed", { name: error.name, code: error.code }); await db.$disconnect(); process.exitCode = 1; process.disconnect(); }
});
