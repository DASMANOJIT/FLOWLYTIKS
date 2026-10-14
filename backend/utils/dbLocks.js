// Only short database work belongs here; all protected queries must use tx.
export const withPgTransactionLock = async (prisma, key, work, options = {}) => {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT pg_try_advisory_xact_lock(hashtext(${key})::bigint) AS acquired
    `;
    if (!rows?.[0]?.acquired) {
      return typeof options.onLocked === "function" ? options.onLocked() : null;
    }
    return work(tx);
  }, { maxWait: 5000, timeout: 10000 });
};
