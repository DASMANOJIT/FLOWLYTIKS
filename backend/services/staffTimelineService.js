import prisma from "../prisma/client.js";
import { followUpStudentId } from "./staffFollowUpService.js";

const invalid = () => Object.assign(new Error("Invalid timeline cursor or limit."), { status: 400 });
const key = (type, id) => `${type}:${type === "P" ? String(id).padStart(10, "0") : id}`;
function boundary(cursor, field, type) {
  if (!cursor) return {};
  const [prefix, id] = cursor.key.split(":");
  const equal = type < prefix ? {} : type === prefix ? { id: { lt: type === "P" ? Number(id) : id } } : null;
  return { OR: [{ [field]: { lt: new Date(cursor.time) } }, ...(equal ? [{ [field]: new Date(cursor.time), ...equal }] : [])] };
}
export async function readStudentTimeline(studentId, options = {}, db = prisma) {
  const id = followUpStudentId(studentId);
  const limit = Number(options.limit || 30);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid();
  let cursor;
  if (options.cursor) {
    try {
      if (typeof options.cursor !== "string" || options.cursor.length > 300) throw invalid();
      cursor = JSON.parse(Buffer.from(options.cursor, "base64url").toString());
      if (cursor.studentId !== id || typeof cursor.key !== "string" || !/^(P:\d{10}|[FA]:[a-zA-Z0-9_-]{1,64})$/.test(cursor.key) || typeof cursor.time !== "string" || !Number.isFinite(Date.parse(cursor.time)) || new Date(cursor.time).toISOString() !== cursor.time) throw invalid();
    } catch { throw invalid(); }
  }
  return db.$transaction(async (tx) => {
    if (!await tx.student.findUnique({ where: { id }, select: { id: true } })) throw Object.assign(new Error("Student not found."), { status: 404 });
    const paymentStates = await tx.payment.findMany({ where: { studentId: id }, select: { id: true, status: true } });
    const paidIds = paymentStates.filter(row => row.status === "paid").map(row => String(row.id));
    const notes = await tx.staffStudentFollowUp.findMany({ where: { studentId: id, ...boundary(cursor, "createdAt", "F") }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, select: { id: true, note: true, createdAt: true, staff: { select: { name: true } } } });
    const paymentSelect = { id: true, month: true, academicYear: true, amount: true, paidAt: true, createdAt: true, paymentProvider: true, phonepePaymentId: true, phonepeTransactionId: true, teacherAdmin: { select: { name: true } }, gatewayOrders: { where: { status: "PAID" }, select: { cashfreeOrderId: true, gatewayReference: true, paymentMethod: true }, take: 1 } };
    const payments = [];
    for (const field of ["paidAt", "createdAt"]) payments.push(...await tx.payment.findMany({ where: { studentId: id, status: "paid", paidAt: field === "paidAt" ? { not: null } : null, ...boundary(cursor, field, "P") }, orderBy: [{ [field]: "desc" }, { id: "desc" }], take: limit + 1, select: paymentSelect }));
    const audits = await tx.auditLog.findMany({ where: { entityType: "Payment", metadataJson: { path: ["studentId"], equals: id }, OR: [{ action: { in: ["PAYMENT_REVERSED", "PAYMENT_MARKED_UNPAID"] } }, { action: "STAFF_CASH_PAYMENT_RECORDED", entityId: { notIn: paidIds } }], AND: [boundary(cursor, "createdAt", "A")] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, select: { id: true, action: true, actorType: true, actorName: true, createdAt: true, metadataJson: true } });
    const attribution = payments.length ? await tx.auditLog.findMany({ where: { entityType: "Payment", entityId: { in: payments.map(row => String(row.id)) }, action: "STAFF_CASH_PAYMENT_RECORDED" }, orderBy: { createdAt: "desc" }, select: { entityId: true, actorName: true } }) : [];
    const events = notes.map(row => ({ id: key("F", row.id), type: "follow-up", createdAt: row.createdAt.toISOString(), note: row.note, staff: row.staff }));
    for (const row of payments) {
      const staff = attribution.find(audit => audit.entityId === String(row.id));
      const method = row.gatewayOrders[0]?.paymentMethod || row.paymentProvider || "Not Available";
      const online = ["CASHFREE", "PHONEPE", "MANUAL_UPI"].includes(row.paymentProvider) || row.gatewayOrders.length > 0 || row.phonepePaymentId || row.phonepeTransactionId;
      events.push({ id: key("P", row.id), type: "payment", createdAt: (row.paidAt || row.createdAt).toISOString(), note: `${row.month} fees paid — ₹${row.amount} — ${method}.\nAcademic session: ${row.academicYear}-${row.academicYear + 1}\nReference: ${row.gatewayOrders[0]?.gatewayReference || row.phonepePaymentId || row.phonepeTransactionId || row.gatewayOrders[0]?.cashfreeOrderId || `FL-${row.academicYear}-${String(row.id).padStart(6, "0")}`}${row.paidAt ? "" : "\nPayment time unavailable; showing record creation time."}`, staff: { name: staff ? `Staff: ${staff.actorName || "Name unavailable"}` : row.teacherAdmin ? `Admin: ${row.teacherAdmin.name}` : online ? "Online payment (recorder not stored)" : "Recorder not available" } });
    }
    for (const row of audits) {
      const data = row.metadataJson || {};
      const reversed = row.action !== "STAFF_CASH_PAYMENT_RECORDED";
      events.push({ id: key("A", row.id), type: reversed ? "reversal" : "payment-history", createdAt: row.createdAt.toISOString(), note: `${reversed ? "Payment reversed / marked unpaid" : "Cash payment recorded (no longer currently paid)"}: ${data.month || "Month unavailable"}\nAcademic session: ${data.academicYear ? `${data.academicYear}-${Number(data.academicYear) + 1}` : "Not available"}\nAmount: ${data.amount === undefined ? "Not available" : `₹${data.amount}`}\nMethod: ${data.method || "Not Available"}\nReference: ${data.reference || "Not available"}`, staff: { name: `${row.actorType}: ${row.actorName || "Name unavailable"}` } });
    }
    events.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const page = events.slice(0, limit), last = page.at(-1);
    return { success: true, events: page, nextCursor: events.length > limit ? Buffer.from(JSON.stringify({ studentId: id, time: last.createdAt, key: last.id })).toString("base64url") : null };
  }, { isolationLevel: "RepeatableRead" });
}
