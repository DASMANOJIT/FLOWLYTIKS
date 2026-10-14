import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import prisma from "../prisma/client.js";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import { authNoStore, createRateLimiter, loginRateLimit, paymentInitiationRateLimit, exportRateLimit } from "../middleware/security.js";
import { addSession, getAccessTokenExpiryMinutes } from "../utils/sessionStore.js";
import { normalizeEmail, isValidEmail } from "../utils/authValidation.js";
import { staffAuthService, staffSelect } from "../services/staffAuthService.js";
import { staffPasswordResetService } from "../services/staffPasswordResetService.js";
import { createAuditLog } from "../services/auditLogService.js";
import { logWarn } from "../utils/appLogger.js";
import { readStaffStudents, readStaffActivity, exportStaffStudents } from "../services/staffPortalService.js";
import { readStudentTimeline } from "../services/staffTimelineService.js";
import { createStaffFollowUp, readStaffFollowUps, listFollowUpStudents } from "../services/staffFollowUpService.js";
import { getStaffPaymentInfo, recordStaffCashPayment } from "../services/staffPaymentService.js";
import { autoPromoteIfEligible } from "../controllers/studentcontrollers.js";
import { readAdminStaffMembers, readAdminFollowUps, readAdminCashCollections, readAdminStaffActivity, readAdminStaffOptions, readAdminEnquiries } from "../services/adminStaffOverviewService.js";

const router = express.Router();
router.use(authNoStore);
const wrap = (handler) => async (req, res) => {
  try {
    if (!prisma.staff || !prisma.staffCreationRequest) {
      throw Object.assign(new Error("Staff setup is incomplete. Regenerate Prisma Client and restart the backend."), { status: 503, code: "STAFF_CLIENT_NOT_READY" });
    }
    await handler(req, res);
  }
  catch (error) {
    const databaseNotReady = ["P2021", "P2022"].includes(error.code);
    const databaseUnavailable = error.name === "PrismaClientInitializationError" || ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(error.code);
    const status = databaseNotReady || databaseUnavailable ? 503 : ["P2002", "P2034"].includes(error.code) ? 409 : error.status || 500;
    const message = databaseNotReady
      ? "Staff database setup is incomplete. The Staff migration must be applied to the intended development database."
      : databaseUnavailable ? "Database unavailable. Please try again."
      : error.code === "P2002" ? "Email is already registered."
      : error.code === "P2034" ? "Another request changed this record. Please try again."
      : error.status ? error.message : "Staff request failed. Please try again.";
    logWarn("staff.request_failed", {
      method: req.method,
      route: `${req.baseUrl || "/api/staff"}${req.route?.path || ""}`,
      status,
      code: error.code || "STAFF_REQUEST_FAILED",
      errorType: error.name,
    });
    res.status(status).json({ success: false, message, code: databaseNotReady ? "STAFF_DATABASE_NOT_READY" : databaseUnavailable ? "STAFF_DATABASE_UNAVAILABLE" : error.code || "STAFF_REQUEST_FAILED", ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
  }
};
const sendLimit = createRateLimiter({ namespace: "staff:create:send", windowMs: 15 * 60 * 1000, max: 5, message: "Too many verification requests. Try again later.", keyGenerator: (req) => String(req.user.id) });
const verifyLimit = createRateLimiter({ namespace: "staff:create:verify", windowMs: 10 * 60 * 1000, max: 15, message: "Too many verification attempts. Try again later.", keyGenerator: (req) => String(req.user.id) });
const resetKey = req => `${req.ip}:${normalizeEmail(req.body?.email)}`;
const resetSendLimit = createRateLimiter({ namespace: "staff:reset:send", windowMs: 15 * 60 * 1000, max: 5, message: "Too many reset requests. Please try again later.", keyGenerator: resetKey });
const resetVerifyLimit = createRateLimiter({ namespace: "staff:reset:verify", windowMs: 10 * 60 * 1000, max: 10, message: "Too many verification attempts. Please try again later.", keyGenerator: resetKey });
const resetSaveLimit = createRateLimiter({ namespace: "staff:reset:save", windowMs: 15 * 60 * 1000, max: 8, message: "Too many password reset attempts. Please try again later.", keyGenerator: resetKey });
router.post("/password-reset/send-code", resetSendLimit, wrap(async (req, res) => res.json(await staffPasswordResetService.send(req.body?.email))));
router.post("/password-reset/verify", resetVerifyLimit, wrap(async (req, res) => res.json(await staffPasswordResetService.verify(req.body?.email, req.body?.code))));
router.post("/password-reset/save", resetSaveLimit, wrap(async (req, res) => res.json(await staffPasswordResetService.save(req.body))));

router.post("/login", loginRateLimit, wrap(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email) || typeof req.body?.password !== "string" || Buffer.byteLength(req.body.password) > 72) return res.status(400).json({ success: false, message: "Enter email and password." });
  const staff = await prisma.staff.findUnique({ where: { email } });
  if (!staff || !await bcrypt.compare(req.body.password, staff.passwordHash)) return res.status(401).json({ success: false, message: "Invalid email or password." });
  if (!staff.isActive || !staff.verifiedAt || staff.role !== "STAFF") return res.status(403).json({ success: false, message: "Staff account is inactive. Please contact admin." });
  const jti = crypto.randomUUID();
  const token = jwt.sign({ id: staff.id, role: "staff" }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: `${getAccessTokenExpiryMinutes()}m`, jwtid: jti });
  await addSession("staff", staff.id, jti, jwt.decode(token).exp * 1000, req);
  res.json({ success: true, token, role: "staff", name: staff.name });
}));

router.get("/me", protect, (req, res) => {
  if (req.userRole !== "staff") return res.status(403).json({ success: false, message: "Staff access required." });
  res.json({ success: true, staff: req.user });
});
const staffOnly = (req, res, next) => {
  if (req.userRole !== "staff") return res.status(403).json({ success: false, message: "Staff access required." });
  next();
};
router.get("/students", protect, staffOnly, wrap(async (req, res) => {
  res.json(await readStaffStudents(req.query));
}));
router.get("/students/export", protect, staffOnly, exportRateLimit, wrap(async (req, res) => {
  res.json(await exportStaffStudents(req.query));
}));
router.get("/activity", protect, staffOnly, wrap(async (req, res) => {
  res.json({ success: true, activity: await readStaffActivity(req.user.id) });
}));
router.get("/students/:studentId/payment", protect, staffOnly, wrap(async (req, res) => {
  res.json(await getStaffPaymentInfo(req.params.studentId, req.query));
}));
router.post("/students/:studentId/pay-cash", protect, staffOnly, paymentInitiationRateLimit, wrap(async (req, res) => {
  const result = await recordStaffCashPayment(req);
  await autoPromoteIfEligible(Number(req.params.studentId), result.academicYear).catch(() => logWarn("staff.cash_promotion_check_failed", { paymentId: result.paymentId }));
  res.status(201).json(result);
}));
router.post("/students/:studentId/follow-ups", protect, staffOnly, wrap(async (req, res) => {
  res.status(201).json(await createStaffFollowUp(req.user.id, req.params.studentId, req.body?.note));
}));
const followUpReader = (req, res, next) => {
  if (!["staff", "admin"].includes(req.userRole)) return res.status(403).json({ success: false, message: "Staff or Admin access required." });
  next();
};
router.get("/students/:studentId/timeline", protect, followUpReader, wrap(async (req, res) => {
  res.json(await readStudentTimeline(req.params.studentId, req.query));
}));
router.get("/follow-ups/students", protect, followUpReader, wrap(async (req, res) => {
  res.json(await listFollowUpStudents(req.query));
}));
router.get("/students/:studentId/follow-ups", protect, followUpReader, wrap(async (req, res) => {
  const records = await readStaffFollowUps(req.params.studentId, prisma, req.query);
  const limit = req.query.limit === undefined ? records.length : Number(req.query.limit);
  const followUps = records.slice(0, limit);
  res.json({ success: true, followUps, nextCursor: records.length > limit ? followUps.at(-1).id : null });
}));
router.get("/members", protect, adminOnly, wrap(async (req, res) => {
  res.json({ success: true, staff: await prisma.staff.findMany({ select: staffSelect, orderBy: { createdAt: "desc" } }) });
}));
router.get("/admin/options", protect, adminOnly, wrap(async (_req, res) => res.json({ success: true, staff: await readAdminStaffOptions() })));
for (const [section, read] of Object.entries({ members: readAdminStaffMembers, "follow-ups": readAdminFollowUps, "cash-collections": readAdminCashCollections, activity: readAdminStaffActivity, enquiries: readAdminEnquiries })) {
  router.get(`/admin/${section}`, protect, adminOnly, wrap(async (req, res) => res.json(await read(req.query))));
}
router.post("/creation/send-code", protect, adminOnly, sendLimit, wrap(async (req, res) => {
  res.json({ success: true, ...await staffAuthService.sendCode(req.user.id, req.body || {}) });
}));
router.post("/creation/resend-code", protect, adminOnly, sendLimit, wrap(async (req, res) => {
  if (typeof req.body?.requestId !== "string") return res.status(400).json({ success: false, message: "Creation request required." });
  res.json({ success: true, ...await staffAuthService.sendCode(req.user.id, {}, req.body.requestId) });
}));
router.post("/creation/verify", protect, adminOnly, verifyLimit, wrap(async (req, res) => {
  const staff = await staffAuthService.verify(req.user.id, req.body?.requestId, req.body?.code);
  await createAuditLog({ req, actorType: "ADMIN", actorId: req.user.id, actorName: req.user.name, action: "STAFF_ACCOUNT_CREATED", entityType: "Staff", entityId: staff.id }).catch(() => console.warn("staff.audit_unavailable"));
  res.status(201).json({ success: true, staff, message: "Staff account created successfully." });
}));
export default router;
