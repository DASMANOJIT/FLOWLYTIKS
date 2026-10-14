const transientCodes = new Set(["P1001", "P1002", "P1017", "P2024"]);

export function isTransientDatabaseError(error) {
  return transientCodes.has(error?.code) || (String(error?.name || "").startsWith("Prisma") && /connection (?:is |was )?closed|kind: Closed|server has closed the connection/i.test(String(error?.message || "")));
}

// Only for reads and idempotent session touches, never payment writes or transactions.
export async function withDatabaseRecovery(operation, label, { sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  try { return await operation(); }
  catch (error) {
    if (!isTransientDatabaseError(error)) throw error;
    console.warn("database.transient_retry", { operation: label, name: error.name, code: error.code || "CONNECTION_CLOSED" });
    await sleep(150);
    return operation();
  }
}
