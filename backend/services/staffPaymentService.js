import prisma from "../prisma/client.js";
import { createCashPaymentForStudent } from "../controllers/paymentcontrollers.js";
import { staffStudentCriteria } from "./staffPortalService.js";
import { followUpStudentId } from "./staffFollowUpService.js";

const fail = (message, status, code) => Object.assign(new Error(message), { status, code });
function period(query) {
  if (!query?.month || query.academicYear === undefined) throw fail("Fee month and academic session are required.", 400, "PERIOD_REQUIRED");
  return staffStudentCriteria({ month: query.month, academicYear: query.academicYear });
}
async function paymentInfo(studentId, query, db) {
  const id = followUpStudentId(studentId);
  const { month, academicYear } = period(query);
  const student = await db.student.findUnique({ where: { id }, select: { id: true, name: true, class: true, phone: true } });
  if (!student) throw fail("Student not found.", 404, "STUDENT_NOT_FOUND");
  const settings = await db.appSettings.findUnique({ where: { id: 1 }, select: { monthlyFee: true } });
  if (!Number.isSafeInteger(settings?.monthlyFee) || settings.monthlyFee <= 0) throw fail("Payment configuration is unavailable.", 503, "FEE_UNAVAILABLE");
  const existing = await db.payment.findUnique({ where: { studentId_month_academicYear: { studentId: id, month, academicYear } } });
  return { student, month, academicYear, amount: settings.monthlyFee, paymentStatus: String(existing?.status || "unpaid").toLowerCase() === "paid" ? "Paid" : "Unpaid", existing };
}
export async function getStaffPaymentInfo(studentId, query, db = prisma) {
  const { existing, ...info } = await paymentInfo(studentId, query, db);
  return { success: true, ...info, onlineVerificationAvailable: false, onlineMessage: "Authoritative QR/UTR verification is unavailable. Entering a UTR cannot mark this fee paid." };
}
export async function recordStaffCashPayment(req, db = prisma, recordCash = createCashPaymentForStudent) {
  if (req.body?.cashReceived !== true) throw fail("Confirm that cash has been received.", 400, "CASH_CONFIRMATION_REQUIRED");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const id = followUpStudentId(req.params.studentId);
        const { month, academicYear } = period(req.body);
        // Match the existing Cashfree creation lock and keep Staff cash actions atomic.
        const locks = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${`cashfree:create:${id}:${academicYear}:${month}`})::bigint) AS acquired`;
        if (!locks[0]?.acquired) throw fail("Another payment is being processed. Please refresh and try again.", 409, "PAYMENT_BUSY");
        const info = await paymentInfo(req.params.studentId, req.body, tx);
        if (info.paymentStatus === "Paid") throw fail("This month is already paid.", 409, "ALREADY_PAID");
        const gateway = await tx.paymentGatewayOrder.findFirst({ where: { studentId: id, month, academicYear, status: { notIn: ["FAILED", "CANCELLED", "EXPIRED"] } }, select: { id: true } });
        if (gateway || info.existing?.phonepeTransactionId || info.existing?.phonepePaymentId || (info.existing?.paymentProvider === "CASHFREE" && info.existing.status !== "failed")) throw fail("An online payment exists or is awaiting verification. Resolve it before recording cash.", 409, "ONLINE_PAYMENT_PENDING");
        const result = await recordCash({ tx, studentId: id, month, academicYear, monthlyFee: info.amount, adminId: null, runPostPaymentActions: false });
        if (result.outcome !== "created") throw fail("This month is already paid or unavailable.", 409, "ALREADY_PAID");
        const reference = `FL-${academicYear}-${String(result.payment.id).padStart(6, "0")}`;
        await tx.auditLog.create({ data: { actorType: "STAFF", actorId: req.user.id, actorName: req.user.name, action: "STAFF_CASH_PAYMENT_RECORDED", entityType: "Payment", entityId: String(result.payment.id), description: "Staff recorded received cash.", metadataJson: { studentId: id, month, academicYear, amount: info.amount, method: "CASH", reference, paidAt: result.payment.paidAt?.toISOString() || null }, ipAddress: req.ip || null, userAgent: req.headers?.["user-agent"] || null } });
        return { success: true, message: "Cash payment recorded successfully.", paymentId: result.payment.id, reference, amount: info.amount, month, academicYear };
      }, { isolationLevel: "Serializable", timeout: 15000 });
    } catch (error) {
      if (error.code === "P2002" && attempt === 2) throw fail("Another payment was recorded for this fee period. Please refresh its status.", 409, "PAYMENT_CONFLICT");
      if (!["P2034", "P2002"].includes(error.code) || attempt === 2) throw error;
    }
  }
}
