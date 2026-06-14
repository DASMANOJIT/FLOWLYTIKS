import crypto from "node:crypto";
import prisma from "../prisma/client.js";

const fallbackSessions = new Map();
const canUseFallbackSessionStore = process.env.NODE_ENV !== "production";
const STALE_CLOSING_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const positiveIntEnv = (name, fallback) => {
  const numeric = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};
const MAX_ACTIVE_SESSIONS = positiveIntEnv("MAX_ACTIVE_SESSIONS_PER_USER", 2);
const SESSION_IDLE_TIMEOUT_MS = positiveIntEnv("SESSION_IDLE_TIMEOUT_MINUTES", 60) * 60 * 1000;
const TOUCH_THROTTLE_MS = 2 * 60 * 1000;
const hashTokenId = (tokenId) =>
  crypto.createHash("sha256").update(String(tokenId || "")).digest("hex");
const userIdKey = (userId) => String(userId);

const buildUserWhere = (role, userId) => ({
  role,
  userId: userIdKey(userId),
  isActive: true,
  revokedAt: null,
  closingRequestedAt: null,
  lastSeenAt: {
    gt: new Date(Date.now() - SESSION_IDLE_TIMEOUT_MS),
  },
  expiresAt: {
    gt: new Date(),
  },
});

const makeFallbackKey = (role, userId) => `${role}:${userIdKey(userId)}`;

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
  const inactiveCutoff = now - SESSION_IDLE_TIMEOUT_MS;
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
  const sessionId = hashTokenId(tokenId);
  const userIdValue = userIdKey(userId);
  try {
    const session = await prisma.userSession.upsert({
      where: { id: sessionId },
      update: {
        role,
        userId: userIdValue,
        expiresAt: new Date(expMs),
        isActive: true,
        lastSeenAt: new Date(),
        closingRequestedAt: null,
        revokedAt: null,
        revokedReason: null,
      },
      create: {
        id: sessionId,
        role,
        userId: userIdValue,
        expiresAt: new Date(expMs),
        isActive: true,
        lastSeenAt: new Date(),
        closingRequestedAt: null,
      },
    });
    await revokeOldestSessions(role, userIdValue, MAX_ACTIVE_SESSIONS, tokenId);
    return session;
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) {
      throw error;
    }
    const key = makeFallbackKey(role, userId);
    pruneFallbackSessions(key);
    if (!fallbackSessions.has(key)) {
      fallbackSessions.set(key, new Map());
    }
    fallbackSessions.get(key).set(sessionId, {
      expMs,
      revokedAt: null,
      closingRequestedAt: null,
      updatedAtMs: Date.now(),
    });
    pruneFallbackSessions(key);
    const sessions = fallbackSessions.get(key);
    if (sessions && sessions.size > MAX_ACTIVE_SESSIONS) {
      const oldest = [...sessions.entries()]
        .filter(([id]) => id !== sessionId)
        .sort((left, right) => (left[1].updatedAtMs || 0) - (right[1].updatedAtMs || 0))
        .slice(0, Math.max(0, sessions.size - MAX_ACTIVE_SESSIONS));
      for (const [id] of oldest) sessions.delete(id);
    }
    return null;
  }
};

export const touchSessionActivity = async (role, userId, tokenId) => {
  const sessionId = hashTokenId(tokenId);
  const now = new Date();
  const throttleCutoff = new Date(Date.now() - TOUCH_THROTTLE_MS);
  try {
    return await prisma.userSession.updateMany({
      where: {
        id: sessionId,
        role,
        userId: userIdKey(userId),
        isActive: true,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
        lastSeenAt: {
          gt: new Date(Date.now() - SESSION_IDLE_TIMEOUT_MS),
          lt: throttleCutoff,
        },
      },
      data: {
        lastSeenAt: now,
        closingRequestedAt: null,
      },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) {
      throw error;
    }
    const key = makeFallbackKey(role, userId);
    const current = fallbackSessions.get(key)?.get(sessionId);
    if (current) {
      current.closingRequestedAt = null;
      current.updatedAtMs = Date.now();
    }
    return null;
  }
};

export const markSessionClosing = async (role, userId, tokenId) => {
  const sessionId = hashTokenId(tokenId);
  try {
    return await prisma.userSession.updateMany({
      where: {
        id: sessionId,
        role,
        userId: userIdKey(userId),
        isActive: true,
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
    const current = sessions?.get(sessionId);
    if (current) {
      current.closingRequestedAt = Date.now();
      current.updatedAtMs = Date.now();
    }
    return null;
  }
};

export const clearSessionClosing = async (role, userId, tokenId) => {
  const sessionId = hashTokenId(tokenId);
  try {
    return await prisma.userSession.updateMany({
      where: {
        id: sessionId,
        role,
        userId: userIdKey(userId),
        isActive: true,
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
    const current = fallbackSessions.get(key)?.get(sessionId);
    if (current) {
      current.closingRequestedAt = null;
      current.updatedAtMs = Date.now();
    }
    return null;
  }
};

export const getSessionState = async (role, userId, tokenId) => {
  const sessionId = hashTokenId(tokenId);
  try {
    const session = await prisma.userSession.findUnique({
      where: { id: sessionId },
      select: {
        role: true,
        userId: true,
        isActive: true,
        revokedAt: true,
        revokedReason: true,
        expiresAt: true,
        closingRequestedAt: true,
        lastSeenAt: true,
        updatedAt: true,
      },
    });

    if (!session) return null;

    return {
      ...session,
      matchesUser:
        session.role === role &&
        session.userId === userIdKey(userId),
    };
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) {
      throw error;
    }
    const key = makeFallbackKey(role, userId);
    pruneFallbackSessions(key);
    const session = fallbackSessions.get(key)?.get(sessionId);
    if (!session) return null;

    return {
      role,
      userId: userIdKey(userId),
      isActive: true,
      revokedAt: session.revokedAt ? new Date(session.revokedAt) : null,
      expiresAt: new Date(session.expMs),
      closingRequestedAt: session.closingRequestedAt
        ? new Date(session.closingRequestedAt)
        : null,
      updatedAt: new Date(session.updatedAtMs || Date.now()),
      lastSeenAt: new Date(session.updatedAtMs || Date.now()),
      matchesUser: true,
    };
  }
};

export const removeSession = async (role, userId, tokenId) => {
  const sessionId = hashTokenId(tokenId);
  try {
    return await prisma.userSession.updateMany({
      where: {
        id: sessionId,
        role,
        userId: userIdKey(userId),
        revokedAt: null,
      },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedReason: "LOGOUT",
      },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) {
      throw error;
    }
    const key = makeFallbackKey(role, userId);
    const sessions = fallbackSessions.get(key);
    if (sessions?.has(sessionId)) {
      sessions.delete(sessionId);
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
        userId: userIdKey(userId),
        revokedAt: null,
      },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedReason: "PASSWORD_CHANGED",
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
      session.isActive !== false &&
      !session.revokedAt &&
      session.expiresAt > new Date() &&
      session.lastSeenAt > new Date(Date.now() - SESSION_IDLE_TIMEOUT_MS)
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
            lastSeenAt: {
              lt: new Date(Date.now() - SESSION_IDLE_TIMEOUT_MS),
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

export const revokeOldestSessions = async (role, userId, maxActive = MAX_ACTIVE_SESSIONS, currentTokenId = null) => {
  const currentSessionId = currentTokenId ? hashTokenId(currentTokenId) : null;
  const activeSessions = await prisma.userSession.findMany({
    where: buildUserWhere(role, userId),
    orderBy: [{ lastSeenAt: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const excess = activeSessions.length - maxActive;
  if (excess <= 0) return { revoked: 0 };
  const revokeIds = activeSessions
    .filter((session) => session.id !== currentSessionId)
    .slice(0, excess)
    .map((session) => session.id);
  if (!revokeIds.length) return { revoked: 0 };
  const result = await prisma.userSession.updateMany({
    where: { id: { in: revokeIds } },
    data: {
      isActive: false,
      revokedAt: new Date(),
      revokedReason: "MAX_DEVICE_LIMIT",
    },
  });
  return { revoked: result.count || 0 };
};
