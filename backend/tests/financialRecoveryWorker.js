import { requireDisposableDatabase } from "./disposableDatabase.js";
requireDisposableDatabase();
const { default: db } = await import("../prisma/client.js");
const [mode, first, second] = process.argv.slice(2);
const continueWhenAsked = () => new Promise(resolve => process.once("message", resolve));
try {
  if (mode === "deadlock" || mode === "crash") {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '4s'");
      await tx.facultyEarningsPayroll.update({ where: { id: first }, data: { totalAmount: { increment: 1 } } });
      const proceed = continueWhenAsked(); process.send({ stage: "locked" }); await proceed;
      await tx.facultyEarningsPayroll.update({ where: { id: second }, data: { totalAmount: { increment: 1 } } });
    }, { timeout: 10000 });
  } else {
    process.env.CASHFREE_PAYOUT_CLIENT_ID = "isolated";
    process.env.CASHFREE_PAYOUT_CLIENT_SECRET = "isolated";
    let dispatches = 0;
    globalThis.fetch = async (url, options) => {
      if (mode === "dispatch") {
        if (options.method !== "POST" || !String(url).endsWith("/transfers")) throw new Error("Unexpected provider request");
        process.send({ stage: "accepted" });
        await new Promise(resolve => process.once("message", resolve));
        throw new Error("Parent must terminate after simulated acceptance");
      }
      if (mode === "recover-pending" && options.method === "POST") {
        if (!String(url).endsWith("/transfers") || ++dispatches !== 1) throw new Error("Only one initial transfer is allowed");
        return new Response(JSON.stringify({ status: "PENDING" }));
      }
      const parsed = new URL(url);
      if (options.method !== "GET" || parsed.pathname !== "/payout/transfers" || !parsed.searchParams.get("transfer_id")) throw new Error("Recovery must only query the retained transfer");
      return new Response(JSON.stringify({ status: "SUCCESS", transfer_id: parsed.searchParams.get("transfer_id") }));
    };
    const { initiatePayoutTransfer, syncPayoutStatus } = await import("../services/cashfreePayoutService.js");
    if (mode === "dispatch") await initiatePayoutTransfer(first);
    else { await initiatePayoutTransfer(first); await syncPayoutStatus(first); }
    if (mode === "recover-pending" && dispatches !== 1) throw new Error("Pending reservation was not dispatched");
  }
  process.send({ stage: "done", ok: true });
} catch (error) { process.send({ stage: "done", ok: false, code: error.code, databaseCode: error.meta?.code, deadlock: /40P01|deadlock detected/i.test(error.message) }); }
finally { await db.$disconnect(); process.disconnect(); }
