import jwt from "jsonwebtoken";
import {
  getSessionState,
  removeSession,
  touchSessionActivity,
} from "../utils/sessionStore.js";
import prisma from "../prisma/client.js";

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
    if (decoded.role === "admin") {
      user = await prisma.admin.findUnique({
        where: { id: decoded.id },
        select: { id: true, name: true, email: true },
      });
    } else if (decoded.role === "student") {
      user = await prisma.student.findUnique({
        where: { id: decoded.id },
        select: { id: true, name: true, email: true, phone: true },
      });
    } else if (decoded.role === "faculty") {
      user = await prisma.faculty.findUnique({
        where: { id: decoded.id },
        select: { id: true, fullName: true, email: true, phone: true, facultyId: true, status: true },
      });
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

    const session = await getSessionState(decoded.role, decoded.id, decoded.jti);
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
    await touchSessionActivity(decoded.role, decoded.id, decoded.jti);

    // Attach user to request
    req.user = user;
    req.userRole = decoded.role;
    req.token = token;
    req.tokenId = decoded.jti || null;

    next();
  } catch (error) {
    console.error("Auth error:", error?.message || error);
    return authJson(res, 401, "Session expired. Please login again.");
  }
};









export const adminOnly = (req, res, next) => {
  if (!req.user || req.userRole !== "admin") {
    return authJson(res, 403, "You do not have permission to perform this action.");
  }
  next();
};
