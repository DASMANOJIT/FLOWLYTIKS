import jwt from "jsonwebtoken";
import {
  getSessionState,
  removeSession,
  touchSessionActivity,
} from "../utils/sessionStore.js";
import prisma from "../prisma/client.js";
import { withDatabaseRecovery } from "../utils/databaseRecovery.js";

const authJson = (res, status, message) =>
  res.status(status).json({
    success: false,
    message,
  });

export const protect = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return authJson(res, 401, "Authentication required.");
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });

    // Fetch user from DB
    let user = null;
    if (decoded.role === "staff") {
      // Staff can use only its own APIs and the shared session lifecycle endpoints.
      const lifecycle = ["/api/auth/heartbeat", "/api/auth/logout", "/api/auth/session/close", "/api/auth/tab-close"];
      const path = req.originalUrl.split("?")[0].replace(/\/$/, "");
      if (!path.startsWith("/api/staff/") && !lifecycle.includes(path)) {
        return authJson(res, 403, "You do not have permission to perform this action.");
      }
      user = await withDatabaseRecovery(() => prisma.staff.findUnique({
        where: { id: decoded.id },
        select: { id: true, name: true, email: true, role: true, isActive: true, verifiedAt: true, createdAt: true },
      }), "auth.staff");
      if (user && (!user.isActive || !user.verifiedAt || user.role !== "STAFF")) {
        return authJson(res, 403, "Staff account is inactive. Please contact admin.");
      }
    } else if (decoded.role === "admin") {
      user = await withDatabaseRecovery(() => prisma.admin.findUnique({
        where: { id: decoded.id },
        select: { id: true, name: true, email: true },
      }), "auth.admin");
    } else if (decoded.role === "student") {
      user = await withDatabaseRecovery(() => prisma.student.findUnique({
        where: { id: decoded.id },
        select: { id: true, name: true, email: true, phone: true },
      }), "auth.student");
    } else if (decoded.role === "faculty") {
      user = await withDatabaseRecovery(() => prisma.faculty.findUnique({
        where: { id: decoded.id },
        select: { id: true, fullName: true, email: true, phone: true, facultyId: true, status: true },
      }), "auth.faculty");
    }

    if (!user) {
      return authJson(res, 401, "Session expired. Please login again.");
    }

    if (decoded.role === "faculty" && user.status !== "ACTIVE") {
      if (decoded.jti) {
        await removeSession(decoded.role, decoded.id, decoded.jti, "FACULTY_INACTIVE");
      }
      return authJson(res, 403, "Faculty account is inactive. Please contact admin.");
    }

    if (!decoded.jti) {
      return authJson(res, 401, "Session expired. Please login again.");
    }

    const session = await withDatabaseRecovery(() => getSessionState(decoded.role, decoded.id, decoded.jti), "auth.session");
    const active =
      session &&
      session.matchesUser &&
      session.isActive !== false &&
      !session.revokedAt &&
      session.expiresAt > new Date() &&
      !session.idleExpired;
    if (!active) {
      if (session?.matchesUser && !session.revokedAt) {
        await removeSession(decoded.role, decoded.id, decoded.jti, "EXPIRED");
      }
      return authJson(res, 401, "Session expired. Please login again.");
    }
    await withDatabaseRecovery(() => touchSessionActivity(decoded.role, decoded.id, decoded.jti), "auth.activity");

    // Attach user to request
    req.user = user;
    req.userRole = decoded.role;
    req.token = token;
    req.tokenId = decoded.jti || null;

    next();
  } catch (error) {
    console.error("Auth error:", { name: error?.name, code: error?.code });
    const tokenError = ["TokenExpiredError", "JsonWebTokenError", "NotBeforeError"].includes(error.name);
    return res.status(tokenError ? 401 : 503).json({
        success: false,
        code: tokenError ? (req.originalUrl?.startsWith("/api/staff/") ? "ADMIN_AUTH_INVALID" : "AUTH_INVALID") : "AUTH_SERVICE_UNAVAILABLE",
        message: tokenError ? "Session expired. Please login again." : "Authentication service unavailable. Please try again.",
      });
  }
};









export const adminOnly = (req, res, next) => {
  if (!req.user || req.userRole !== "admin") {
    return authJson(res, 403, "You do not have permission to perform this action.");
  }
  next();
};
