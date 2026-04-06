export const withPgAdvisoryLock = async (prisma, key, work, options = {}) => {
  const { onLocked } = options;
  const rows = await prisma.$queryRaw`
    SELECT pg_try_advisory_lock(hashtext(${key})::bigint) AS acquired
  `;
  const acquired = Boolean(rows?.[0]?.acquired);

  if (!acquired) {
    return typeof onLocked === "function" ? onLocked() : null;
  }

  try {
    return await work();
  } finally {
    await prisma.$queryRaw`
      SELECT pg_advisory_unlock(hashtext(${key})::bigint) AS released
    `;
  }
};
