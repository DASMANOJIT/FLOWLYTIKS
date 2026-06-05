import jwt from "jsonwebtoken";
import {
  clearSessionClosing,
  getSessionState,
} from "../utils/sessionStore.js";
import prisma from "../prisma/client.js";

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
      return res.status(401).json({ success: false, message: "Not authorized, no token" });
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
        select: {
          id: true,
          facultyId: true,
          username: true,
          fullName: true,
          email: true,
          phone: true,
          gender: true,
          dob: true,
          address: true,
          designation: true,
          qualification: true,
          experienceYears: true,
          joiningDate: true,
          employmentType: true,
          salaryType: true,
          salaryAmount: true,
          paymentNotes: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }

    if (!user) {
      return res.status(401).json({ success: false, message: "Not authorized, invalid user" });
    }

    if (decoded.jti) {
      const session = await getSessionState(decoded.role, decoded.id, decoded.jti);
      const active =
        session &&
        session.matchesUser &&
        !session.revokedAt &&
        session.expiresAt > new Date();
      if (!active) {
        return res
          .status(401)
          .json({ success: false, message: "Session expired or logged out. Please login again." });
      }
      if (session.closingRequestedAt) {
        await clearSessionClosing(decoded.role, decoded.id, decoded.jti);
      }
    }

    // Attach user to request
    req.user = user;
    req.userRole = decoded.role;
    req.token = token;
    req.tokenId = decoded.jti || null;

    next();
  } catch (error) {
    console.error("Auth error:", error?.message || error);
    return res.status(401).json({ success: false, message: "Not authorized, token failed" });
  }
};









export const adminOnly = (req, res, next) => {
  if (!req.user || req.userRole !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden: Admins only" });
  }
  next();
};
