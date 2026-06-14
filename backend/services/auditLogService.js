import prisma from "../prisma/client.js";

const SENSITIVE_KEY_PATTERN = /(password|passwordHash|otp|token|secret|authorization|signature|accountNumber|bankAccount|upiId|ifsc|panNumber|clientSecret|apiKey)/i;

const text = (value) => String(value || "").trim();

const getIp = (req) => {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
};

export const sanitizeAuditMetadata = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeAuditMetadata(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 80)
      .map(([key, item]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeAuditMetadata(item, depth + 1),
      ])
  );
};

export const buildAuditActor = (req) => ({
  actorType: String(req.userRole || "SYSTEM").toUpperCase(),
  actorId: req.user?.id ? String(req.user.id) : null,
  actorName: req.user?.fullName || req.user?.name || req.user?.email || null,
});

export const createAuditLog = async ({
  req,
  actorType,
  actorId,
  actorName,
  action,
  entityType,
  entityId,
  description,
  metadata,
}) => {
  try {
    const actor = req ? buildAuditActor(req) : {};
    return await prisma.auditLog.create({
      data: {
        actorType: text(actorType || actor.actorType || "SYSTEM"),
        actorId: actorId ? String(actorId) : actor.actorId || null,
        actorName: text(actorName || actor.actorName) || null,
        action: text(action || "UNKNOWN"),
        entityType: text(entityType || "SYSTEM"),
        entityId: entityId ? String(entityId) : null,
        description: text(description) || null,
        metadataJson: sanitizeAuditMetadata(metadata || null),
        ipAddress: req ? getIp(req) : null,
        userAgent: req?.headers?.["user-agent"] ? String(req.headers["user-agent"]).slice(0, 500) : null,
      },
    });
  } catch (error) {
    console.error("Audit log write failed:", error?.message || error);
    return null;
  }
};

export const auditAction = ({ action, entityType, entityId, description, metadata } = {}) => {
  return (req, res, next) => {
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      createAuditLog({
        req,
        action,
        entityType,
        entityId: typeof entityId === "function" ? entityId(req, res) : entityId,
        description: typeof description === "function" ? description(req, res) : description,
        metadata: typeof metadata === "function" ? metadata(req, res) : metadata,
      });
    });
    next();
  };
};

export const listAuditLogs = async ({ actorType, action, entityType, startDate, endDate, page = 1, limit = 50 } = {}) => {
  const where = {};
  if (actorType && actorType !== "all") where.actorType = String(actorType).toUpperCase();
  if (action && action !== "all") where.action = String(action);
  if (entityType && entityType !== "all") where.entityType = String(entityType);
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(`${startDate}T00:00:00.000Z`);
    if (endDate) where.createdAt.lte = new Date(`${endDate}T23:59:59.999Z`);
  }
  const safePage = Math.max(Number(page || 1), 1);
  const safeLimit = Math.min(Math.max(Number(limit || 50), 1), 200);
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return {
    logs,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};
