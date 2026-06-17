import crypto from "crypto";
import prisma from "../prisma/client.js";


function normalizeSessionUserId(userId) {
  if (userId === undefined || userId === null) {
    throw new Error("Session userId is required");
  }

  const text = String(userId).trim();
  if (!text) {
    throw new Error("Session userId is required");
  }
  return text;
}
const fallbackSessions = new Map();
const canUseFallbackSessionStore = process.env.NODE_ENV !== "production";
const DEFAULT_MAX_ACTIVE_SESSIONS = 2;
const DEFAULT_IDLE_TIMEOUT_MINUTES = 60;
const TOUCH_THROTTLE_MS = 90 * 1000;

const getPositiveInt = (name, fallback) => {
  const value = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const getMaxActiveSessions = () =>
  getPositiveInt("MAX_ACTIVE_SESSIONS_PER_USER", DEFAULT_MAX_ACTIVE_SESSIONS);

export const getSessionIdleTimeoutMs = () =>
  getPositiveInt("SESSION_IDLE_TIMEOUT_MINUTES", DEFAULT_IDLE_TIMEOUT_MINUTES) * 60 * 1000;

export const getAccessTokenExpiryMinutes = () =>
  getPositiveInt("ACCESS_TOKEN_EXPIRY_MINUTES", 30);

const hashSessionToken = (tokenId) =>
  crypto.createHash("sha256").update(String(tokenId || "")).digest("hex");

const nowDate = () => new Date();

const activeSessionWhere = (role, userId) => ({
  role,
  userId: normalizeSessionUserId(userId),
  isActive: true,
  revokedAt: null,
  expiresAt: { gt: nowDate() },
  lastSeenAt: { gt: new Date(Date.now() - getSessionIdleTimeoutMs()) },
});

const makeFallbackKey = (role, userId) => `${role}:${String(userId)}`;

const shouldUseFallbackSessionStore = (error) => {
  const message = String(error?.message || "");
  return (
    error?.name === "PrismaClientInitializationError" ||
    /does not exist|The table .* does not exist|Unknown argument/i.test(message) ||
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Can't reach database server/i.test(message)
  );
};

const pruneFallbackSessions = (key) => {
  const sessions = fallbackSessions.get(key);
  if (!sessions) return;
  const now = Date.now();
  const inactiveCutoff = now - getSessionIdleTimeoutMs();

  for (const [tokenId, session] of sessions.entries()) {
    if (
      !session.isActive ||
      session.revokedAt ||
      session.expMs <= now ||
      session.lastSeenAtMs <= inactiveCutoff
    ) {
      sessions.delete(tokenId);
    }
  }

  if (!sessions.size) fallbackSessions.delete(key);
};

export const cleanupExpiredSessions = async (role, userId) => {
  const now = nowDate();
  const idleCutoff = new Date(Date.now() - getSessionIdleTimeoutMs());

  try {
    return await prisma.userSession.updateMany({
      where: {
        role,
        userId: normalizeSessionUserId(userId),
        isActive: true,
        revokedAt: null,
        OR: [{ expiresAt: { lte: now } }, { lastSeenAt: { lte: idleCutoff } }],
      },
      data: {
        isActive: false,
        revokedAt: now,
        revokedReason: "EXPIRED",
      },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) throw error;
    const key = makeFallbackKey(role, userId);
    pruneFallbackSessions(key);
    return null;
  }
};

export const revokeOldestActiveSessions = async (role, userId, keepLatestCount = getMaxActiveSessions() - 1) => {
  await cleanupExpiredSessions(role, userId);

  try {
    const activeSessions = await prisma.userSession.findMany({
      where: activeSessionWhere(role, userId),
      orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    const sessionsToRevoke = activeSessions.slice(Math.max(0, keepLatestCount));
    if (!sessionsToRevoke.length) return 0;

    const result = await prisma.userSession.updateMany({
      where: { id: { in: sessionsToRevoke.map((session) => session.id) } },
      data: {
        isActive: false,
        revokedAt: nowDate(),
        revokedReason: "MAX_DEVICE_LIMIT",
      },
    });
    return result.count || 0;
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) throw error;
    const key = makeFallbackKey(role, userId);
    pruneFallbackSessions(key);
    const sessions = [...(fallbackSessions.get(key)?.entries() || [])].sort(
      (a, b) => (b[1].lastSeenAtMs || 0) - (a[1].lastSeenAtMs || 0)
    );
    for (const [tokenId] of sessions.slice(Math.max(0, keepLatestCount))) {
      fallbackSessions.get(key)?.delete(tokenId);
    }
    return Math.max(0, sessions.length - keepLatestCount);
  }
};

export const getActiveSessionCount = async (role, userId) => {
  await cleanupExpiredSessions(role, userId);

  try {
    return await prisma.userSession.count({
      where: activeSessionWhere(role, userId),
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) throw error;
    const key = makeFallbackKey(role, userId);
    pruneFallbackSessions(key);
    return fallbackSessions.get(key)?.size || 0;
  }
};

export const addSession = async (role, userId, tokenId, expMs, req = null) => {
  await revokeOldestActiveSessions(role, userId, getMaxActiveSessions() - 1);

  const now = nowDate();
  const userAgent = String(req?.headers?.["user-agent"] || "").slice(0, 500) || null;
  const ipAddress = String(req?.ip || req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim() || null;

  try {
    return await prisma.userSession.create({
      data: {
        role,
        userId: normalizeSessionUserId(userId),
        sessionTokenHash: hashSessionToken(tokenId),
        deviceId: hashSessionToken(`${userAgent || "unknown"}:${ipAddress || "unknown"}`).slice(0, 32),
        deviceName: userAgent ? userAgent.slice(0, 120) : "Unknown device",
        userAgent,
        ipAddress,
        isActive: true,
        lastSeenAt: now,
        expiresAt: new Date(expMs),
      },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) throw error;
    const key = makeFallbackKey(role, userId);
    pruneFallbackSessions(key);
    if (!fallbackSessions.has(key)) fallbackSessions.set(key, new Map());
    fallbackSessions.get(key).set(tokenId, {
      expMs,
      isActive: true,
      revokedAt: null,
      lastSeenAtMs: Date.now(),
      closingRequestedAt: null,
    });
    return null;
  }
};

export const getSessionState = async (role, userId, tokenId) => {
  const sessionTokenHash = hashSessionToken(tokenId);

  try {
    const session = await prisma.userSession.findUnique({
      where: { sessionTokenHash },
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
        String(session.userId) === String(normalizeSessionUserId(userId)),
      idleExpired: session.lastSeenAt <= new Date(Date.now() - getSessionIdleTimeoutMs()),
    };
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) throw error;
    const key = makeFallbackKey(role, userId);
    pruneFallbackSessions(key);
    const session = fallbackSessions.get(key)?.get(tokenId);
    if (!session) return null;

    return {
      role,
      userId: normalizeSessionUserId(userId),
      isActive: session.isActive,
      revokedAt: session.revokedAt ? new Date(session.revokedAt) : null,
      revokedReason: null,
      expiresAt: new Date(session.expMs),
      closingRequestedAt: session.closingRequestedAt ? new Date(session.closingRequestedAt) : null,
      lastSeenAt: new Date(session.lastSeenAtMs || Date.now()),
      updatedAt: new Date(session.lastSeenAtMs || Date.now()),
      matchesUser: true,
      idleExpired: (session.lastSeenAtMs || 0) <= Date.now() - getSessionIdleTimeoutMs(),
    };
  }
};

export const touchSessionActivity = async (role, userId, tokenId, { force = false } = {}) => {
  const session = await getSessionState(role, userId, tokenId);
  if (!session?.matchesUser || !session.isActive || session.revokedAt || session.idleExpired) {
    return { count: 0 };
  }

  const shouldTouch =
    force || !session.lastSeenAt || session.lastSeenAt <= new Date(Date.now() - TOUCH_THROTTLE_MS);
  if (!shouldTouch) return { count: 1 };

  try {
    return await prisma.userSession.updateMany({
      where: {
        sessionTokenHash: hashSessionToken(tokenId),
        role,
        userId: normalizeSessionUserId(userId),
        isActive: true,
        revokedAt: null,
        expiresAt: { gt: nowDate() },
      },
      data: {
        lastSeenAt: nowDate(),
        closingRequestedAt: null,
      },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) throw error;
    const key = makeFallbackKey(role, userId);
    const current = fallbackSessions.get(key)?.get(tokenId);
    if (current) {
      current.closingRequestedAt = null;
      current.lastSeenAtMs = Date.now();
    }
    return { count: current ? 1 : 0 };
  }
};

export const markSessionClosing = async (role, userId, tokenId) => {
  try {
    return await prisma.userSession.updateMany({
      where: {
        sessionTokenHash: hashSessionToken(tokenId),
        role,
        userId: normalizeSessionUserId(userId),
        isActive: true,
        revokedAt: null,
      },
      data: {
        isActive: false,
        revokedAt: nowDate(),
        revokedReason: "BROWSER_CLOSED",
        closingRequestedAt: nowDate(),
      },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) throw error;
    const key = makeFallbackKey(role, userId);
    const sessions = fallbackSessions.get(key);
    if (sessions?.has(tokenId)) sessions.delete(tokenId);
    return null;
  }
};

export const clearSessionClosing = async (role, userId, tokenId) => {
  try {
    return await prisma.userSession.updateMany({
      where: {
        sessionTokenHash: hashSessionToken(tokenId),
        role,
        userId: normalizeSessionUserId(userId),
        isActive: true,
        revokedAt: null,
      },
      data: { closingRequestedAt: null },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) throw error;
    const key = makeFallbackKey(role, userId);
    const current = fallbackSessions.get(key)?.get(tokenId);
    if (current) current.closingRequestedAt = null;
    return null;
  }
};

export const removeSession = async (role, userId, tokenId, reason = "LOGOUT") => {
  try {
    return await prisma.userSession.updateMany({
      where: {
        sessionTokenHash: hashSessionToken(tokenId),
        role,
        userId: normalizeSessionUserId(userId),
        revokedAt: null,
      },
      data: {
        isActive: false,
        revokedAt: nowDate(),
        revokedReason: reason,
      },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) throw error;
    const key = makeFallbackKey(role, userId);
    const sessions = fallbackSessions.get(key);
    if (sessions?.has(tokenId)) sessions.delete(tokenId);
    if (sessions && !sessions.size) fallbackSessions.delete(key);
    return null;
  }
};

export const clearUserSessions = async (role, userId, reason = "PASSWORD_CHANGED") => {
  try {
    return await prisma.userSession.updateMany({
      where: {
        role,
        userId: normalizeSessionUserId(userId),
        revokedAt: null,
      },
      data: {
        isActive: false,
        revokedAt: nowDate(),
        revokedReason: reason,
      },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) throw error;
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
      !session.idleExpired
  );
};

export const purgeExpiredSessions = async () => {
  const now = nowDate();
  const idleCutoff = new Date(Date.now() - getSessionIdleTimeoutMs());
  const oldRevokedCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  try {
    await prisma.userSession.updateMany({
      where: {
        isActive: true,
        revokedAt: null,
        OR: [{ expiresAt: { lte: now } }, { lastSeenAt: { lte: idleCutoff } }],
      },
      data: {
        isActive: false,
        revokedAt: now,
        revokedReason: "EXPIRED",
      },
    });

    await prisma.userSession.deleteMany({
      where: {
        revokedAt: {
          lt: oldRevokedCutoff,
        },
      },
    });
  } catch (error) {
    if (!canUseFallbackSessionStore || !shouldUseFallbackSessionStore(error)) throw error;
    for (const key of fallbackSessions.keys()) pruneFallbackSessions(key);
  }
};
