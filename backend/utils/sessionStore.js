import prisma from "../prisma/client.js";

const fallbackSessions = new Map();
const canUseFallbackSessionStore = process.env.NODE_ENV !== "production";
const ACTIVE_SESSION_WINDOW_MS = 15 * 60 * 1000;
const STALE_CLOSING_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const buildUserWhere = (role, userId) => ({
  role,
  userId: Number(userId),
  revokedAt: null,
  closingRequestedAt: null,
  updatedAt: {
    gt: new Date(Date.now() - ACTIVE_SESSION_WINDOW_MS),
  },
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
  const inactiveCutoff = now - ACTIVE_SESSION_WINDOW_MS;
  const staleClosingCutoff = now - STALE_CLOSING_SESSION_MAX_AGE_MS;

  for (const [tokenId, session] of sessions.entries()) {
    if (
      session.revokedAt ||
      session.expMs <= now ||
      session.updatedAtMs <= inactiveCutoff ||
      (session.closingRequestedAt && session.closingRequestedAt <= staleClosingCutoff)
    ) {
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
        closingRequestedAt: null,
        revokedAt: null,
      },
      create: {
        id: tokenId,
        role,
        userId: Number(userId),
        expiresAt: new Date(expMs),
        closingRequestedAt: null,
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
    fallbackSessions.get(key).set(tokenId, {
      expMs,
      revokedAt: null,
      closingRequestedAt: null,
      updatedAtMs: Date.now(),
    });
    return null;
  }
};

export const touchSessionActivity = async (role, userId, tokenId) => {
  try {
    return await prisma.userSession.updateMany({
      where: {
        id: tokenId,
        role,
        userId: Number(userId),
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        closingRequestedAt: null,
      },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) {
      throw error;
    }
    const key = makeFallbackKey(role, userId);
    const current = fallbackSessions.get(key)?.get(tokenId);
    if (current) {
      current.closingRequestedAt = null;
      current.updatedAtMs = Date.now();
    }
    return null;
  }
};

export const markSessionClosing = async (role, userId, tokenId) => {
  try {
    return await prisma.userSession.updateMany({
      where: {
        id: tokenId,
        role,
        userId: Number(userId),
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        closingRequestedAt: new Date(),
      },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) {
      throw error;
    }
    const key = makeFallbackKey(role, userId);
    const sessions = fallbackSessions.get(key);
    const current = sessions?.get(tokenId);
    if (current) {
      current.closingRequestedAt = Date.now();
      current.updatedAtMs = Date.now();
    }
    return null;
  }
};

export const clearSessionClosing = async (role, userId, tokenId) => {
  try {
    return await prisma.userSession.updateMany({
      where: {
        id: tokenId,
        role,
        userId: Number(userId),
        revokedAt: null,
      },
      data: {
        closingRequestedAt: null,
      },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) {
      throw error;
    }
    const key = makeFallbackKey(role, userId);
    const current = fallbackSessions.get(key)?.get(tokenId);
    if (current) {
      current.closingRequestedAt = null;
      current.updatedAtMs = Date.now();
    }
    return null;
  }
};

export const getSessionState = async (role, userId, tokenId) => {
  try {
    const session = await prisma.userSession.findUnique({
      where: { id: tokenId },
      select: {
        role: true,
        userId: true,
        revokedAt: true,
        expiresAt: true,
        closingRequestedAt: true,
        updatedAt: true,
      },
    });

    if (!session) return null;

    return {
      ...session,
      matchesUser:
        session.role === role &&
        session.userId === Number(userId),
    };
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) {
      throw error;
    }
    const key = makeFallbackKey(role, userId);
    pruneFallbackSessions(key);
    const session = fallbackSessions.get(key)?.get(tokenId);
    if (!session) return null;

    return {
      role,
      userId: Number(userId),
      revokedAt: session.revokedAt ? new Date(session.revokedAt) : null,
      expiresAt: new Date(session.expMs),
      closingRequestedAt: session.closingRequestedAt
        ? new Date(session.closingRequestedAt)
        : null,
      updatedAt: new Date(session.updatedAtMs || Date.now()),
      matchesUser: true,
    };
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
  const session = await getSessionState(role, userId, tokenId);

  return Boolean(
    session &&
      session.matchesUser &&
      !session.revokedAt &&
      session.expiresAt > new Date()
  );
};

export const purgeExpiredSessions = async () => {
  const now = new Date();
  const revokedCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const closingCutoff = new Date(Date.now() - STALE_CLOSING_SESSION_MAX_AGE_MS);
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
          {
            closingRequestedAt: {
              lt: closingCutoff,
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
