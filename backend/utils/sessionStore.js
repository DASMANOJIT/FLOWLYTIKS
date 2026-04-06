import prisma from "../prisma/client.js";

const fallbackSessions = new Map();
const canUseFallbackSessionStore = process.env.NODE_ENV !== "production";

const buildUserWhere = (role, userId) => ({
  role,
  userId: Number(userId),
  revokedAt: null,
  expiresAt: {
    gt: new Date(),
  },
});

const makeFallbackKey = (role, userId) => `${role}:${Number(userId)}`;

const shouldUseFallbackSessionStore = (error) => {
  const message = String(error?.message || "");
  return (
    error?.name === "PrismaClientInitializationError" ||
    /does not exist|The table .* does not exist/i.test(message) ||
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Can't reach database server/i.test(message)
  );
};

const pruneFallbackSessions = (key) => {
  const sessions = fallbackSessions.get(key);
  if (!sessions) return;
  const now = Date.now();

  for (const [tokenId, session] of sessions.entries()) {
    if (session.revokedAt || session.expMs <= now) {
      sessions.delete(tokenId);
    }
  }

  if (!sessions.size) {
    fallbackSessions.delete(key);
  }
};

export const getActiveSessionCount = async (role, userId) => {
  try {
    return await prisma.userSession.count({
      where: buildUserWhere(role, userId),
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) {
      throw error;
    }
    const key = makeFallbackKey(role, userId);
    pruneFallbackSessions(key);
    return fallbackSessions.get(key)?.size || 0;
  }
};

export const addSession = async (role, userId, tokenId, expMs) => {
  try {
    return await prisma.userSession.upsert({
      where: { id: tokenId },
      update: {
        role,
        userId: Number(userId),
        expiresAt: new Date(expMs),
        revokedAt: null,
      },
      create: {
        id: tokenId,
        role,
        userId: Number(userId),
        expiresAt: new Date(expMs),
      },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) {
      throw error;
    }
    const key = makeFallbackKey(role, userId);
    pruneFallbackSessions(key);
    if (!fallbackSessions.has(key)) {
      fallbackSessions.set(key, new Map());
    }
    fallbackSessions.get(key).set(tokenId, { expMs, revokedAt: null });
    return null;
  }
};

export const removeSession = async (role, userId, tokenId) => {
  try {
    return await prisma.userSession.updateMany({
      where: {
        id: tokenId,
        role,
        userId: Number(userId),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) {
      throw error;
    }
    const key = makeFallbackKey(role, userId);
    const sessions = fallbackSessions.get(key);
    if (sessions?.has(tokenId)) {
      sessions.delete(tokenId);
    }
    if (sessions && !sessions.size) {
      fallbackSessions.delete(key);
    }
    return null;
  }
};

export const clearUserSessions = async (role, userId) => {
  try {
    return await prisma.userSession.updateMany({
      where: {
        role,
        userId: Number(userId),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) {
      throw error;
    }
    fallbackSessions.delete(makeFallbackKey(role, userId));
    return null;
  }
};

export const isSessionActive = async (role, userId, tokenId) => {
  try {
    const session = await prisma.userSession.findUnique({
      where: { id: tokenId },
      select: {
        role: true,
        userId: true,
        revokedAt: true,
        expiresAt: true,
      },
    });

    return Boolean(
      session &&
        session.role === role &&
        session.userId === Number(userId) &&
        !session.revokedAt &&
        session.expiresAt > new Date()
    );
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) {
      throw error;
    }
    const key = makeFallbackKey(role, userId);
    pruneFallbackSessions(key);
    return Boolean(fallbackSessions.get(key)?.has(tokenId));
  }
};

export const purgeExpiredSessions = async () => {
  const now = new Date();
  const revokedCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  try {
    await prisma.userSession.deleteMany({
      where: {
        OR: [
          {
            expiresAt: {
              lt: now,
            },
          },
          {
            revokedAt: {
              lt: revokedCutoff,
            },
          },
        ],
      },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) {
      throw error;
    }
    for (const key of fallbackSessions.keys()) {
      pruneFallbackSessions(key);
    }
  }
};
