import prisma from "../prisma/client.js";
import { logInfo, logWarn } from "../utils/appLogger.js";

const sanitizeMetadata = (value) => {
  if (!value || typeof value !== "object") return value || null;

  const blocked = /(password|otp|secret|token|authorization|accountNumber|bankAccount)/i;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !blocked.test(key))
  );
};

export const createAuditLog = async ({
  req = null,
  actorType = "SYSTEM",
  actorId = null,
  actorName = null,
  action,
  entityType = null,
  entityId = null,
  description = null,
  metadata = null,
} = {}) => {
  const safeMetadata = sanitizeMetadata(metadata);

  if (!prisma.auditLog) {
    logInfo("audit.log.skipped", {
      actorType,
      actorId,
      action,
      entityType,
      entityId,
      reason: "AuditLog model unavailable",
    });
    return null;
  }

  return prisma.auditLog.create({
    data: {
      actorType,
      actorId: actorId == null ? null : String(actorId),
      actorName,
      action,
      entityType,
      entityId: entityId == null ? null : String(entityId),
      description,
      metadataJson: safeMetadata,
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.["user-agent"] || null,
    },
  });
};

export const auditAction = ({ action, entityType = null, entityId = null, metadata = null } = {}) =>
  async (req, res, next) => {
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      const resolvedEntityId =
        typeof entityId === "function" ? entityId(req) : entityId ?? req.params?.id ?? null;
      const resolvedMetadata = typeof metadata === "function" ? metadata(req) : metadata;

      createAuditLog({
        req,
        actorType: req.userRole ? String(req.userRole).toUpperCase() : "SYSTEM",
        actorId: req.user?.id || null,
        actorName: req.user?.name || req.user?.fullName || req.user?.email || null,
        action,
        entityType,
        entityId: resolvedEntityId,
        metadata: resolvedMetadata,
      }).catch(() => {});
    });
    next();
  };

export const listAuditLogs = async ({
  actorType,
  action,
  entityType,
  startDate,
  endDate,
  page = 1,
  limit = 50,
} = {}) => {
  const safePage = Math.max(Number(page || 1), 1);
  const safeLimit = Math.min(Math.max(Number(limit || 50), 1), 200);

  if (prisma.auditLog) {
    const where = {};
    if (actorType && actorType !== "all") where.actorType = String(actorType).toUpperCase();
    if (action && action !== "all") where.action = String(action);
    if (entityType && entityType !== "all") where.entityType = String(entityType);
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(`${startDate}T00:00:00.000Z`);
      if (endDate) where.createdAt.lte = new Date(`${endDate}T23:59:59.999Z`);
    }

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
  }

  const conditions = [];
  const values = [];
  const addCondition = (clause, value) => {
    values.push(value);
    conditions.push(clause.replace("?", `$${values.length}`));
  };

  if (actorType && actorType !== "all") addCondition('"actorType" = ?', String(actorType).toUpperCase());
  if (action && action !== "all") addCondition('"action" = ?', String(action));
  if (entityType && entityType !== "all") addCondition('"entityType" = ?', String(entityType));
  if (startDate) addCondition('"createdAt" >= ?', new Date(`${startDate}T00:00:00.000Z`));
  if (endDate) addCondition('"createdAt" <= ?', new Date(`${endDate}T23:59:59.999Z`));

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (safePage - 1) * safeLimit;

  try {
    const logs = await prisma.$queryRawUnsafe(
      `SELECT "id", "actorType", "actorId", "actorName", "action", "entityType", "entityId", "description", "metadataJson", "ipAddress", "userAgent", "createdAt"
       FROM "AuditLog"
       ${whereSql}
       ORDER BY "createdAt" DESC
       OFFSET $${values.length + 1}
       LIMIT $${values.length + 2}`,
      ...values,
      offset,
      safeLimit
    );
    const countRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "AuditLog" ${whereSql}`,
      ...values
    );
    const total = Number(countRows?.[0]?.count || 0);
    return {
      logs,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };
  } catch (error) {
    logWarn("audit.log.list_unavailable", { message: error?.message || error });
    return {
      logs: [],
      pagination: { page: safePage, limit: safeLimit, total: 0, totalPages: 1 },
    };
  }
};
