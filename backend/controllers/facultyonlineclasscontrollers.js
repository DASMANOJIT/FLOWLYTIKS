import prisma from "../prisma/client.js";
import { createAuditLog } from "../services/auditLogService.js";
import { listOnlineClasses, saveOnlineClass, transitionOnlineClass } from "../services/facultyOnlineClassService.js";
import { checkOnlineMeeting } from "../services/meetVerificationService.js";
import { getMeetingAttendance, buildMeetAttendancePdf } from "../services/meetAttendancePdfService.js";
import { deleteFacultyOnlineClass } from "../services/facultyOnlineClassDeletionService.js";
import { getOnlineClassSummary, listOnlineClassDirectory, saveDirectoryItem, deleteOnlineClassBatch } from "../services/adminOnlineClassService.js";

const respond = handler => async (req, res) => {
  try { await handler(req, res); }
  catch (error) {
    console.error("Online class request failed:", { name: error?.name, code: error?.code, status: error?.status });
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Unable to process online classes. Please try again." });
  }
};

export const getMyOnlineClasses = respond(async (req, res) => {
  const result = await listOnlineClasses({ facultyId: req.user.id, incentiveTypeId: req.query.incentiveTypeId, page: Number(req.query.page || 1), historyFilters: req.query.historyFilters === "true", search: req.query.search, date: req.query.date, batch: req.query.batch });
  const faculty = await prisma.faculty.findUnique({ where: { id: req.user.id }, select: { fullName: true } });
  res.json({ success: true, ...result, teacherName: faculty.fullName, batches: result.batches || [] });
});

export const getAdminOnlineClasses = respond(async (req, res) => {
  const result = await listOnlineClasses({ facultyId: req.query.facultyId, paymentId: req.query.paymentId, page: Number(req.query.page || 1), historyFilters: true, search: req.query.search, date: req.query.date, batch: req.query.batch, status: req.query.status });
  const faculties = await prisma.faculty.findMany({ select: { id: true, fullName: true, facultyId: true }, orderBy: { fullName: "asc" } });
  res.json({ success: true, ...result, faculties });
});

const audit = (req, record, action) => createAuditLog({ req, actorType: req.userRole === "admin" ? "ADMIN" : "FACULTY", actorId: req.user.id, actorName: req.user.fullName || req.user.name, action,
  entityType: "FacultyOnlineClass", entityId: record.id, metadata: { status: record.status, incentiveEntryId: record.incentive?.id || null },
}).catch(error => console.error("Online class audit failed:", { name: error?.name, code: error?.code }));

export const saveMyOnlineClass = respond(async (req, res) => {
  const record = await saveOnlineClass(req.user.id, req.body, req.params.id || null);
  await audit(req, record, req.params.id ? "ONLINE_CLASS_UPDATED" : "ONLINE_CLASS_SCHEDULED");
  res.json({ success: true, record });
});

export const changeMyOnlineClass = respond(async (req, res) => {
  const record = req.params.action === "check" ? await checkOnlineMeeting(req.params.id, req.user.id) : await transitionOnlineClass(req.user.id, req.params.id, req.params.action);
  await audit(req, record, `ONLINE_CLASS_${record.status}`);
  res.json({ success: true, record });
});

export const deleteMyOnlineClass = respond(async (req, res) => {
  const result = await deleteFacultyOnlineClass(req.user.id, req.params.id);
  if (!result.alreadyDeleted) await audit(req, { id: req.params.id, status: "DELETED" }, "ONLINE_CLASS_DELETED");
  res.json({ success: true, ...result, message: "Class deleted. Any linked unpaid incentive was reversed." });
});

export const adminOnlineClassSummary = respond(async (req, res) => res.json({ success: true, ...await getOnlineClassSummary() }));
export const getOnlineDirectory = respond(async (req, res) => res.json({ success: true, batches: await listOnlineClassDirectory(req.userRole !== "admin", prisma, req.query.search) }));
export const deleteOnlineDirectoryBatch = respond(async (req, res) => {
  const record = await deleteOnlineClassBatch(req.params.id);
  await createAuditLog({ req, actorType: "ADMIN", actorId: req.user.id, actorName: req.user.name, action: "ONLINE_CLASS_BATCH_DELETED", entityType: "OnlineClassBatch", entityId: record.id, metadata: { name: record.name } }).catch(error => console.warn("Online class directory audit failed", { code: error.code, name: error.name }));
  res.json({ success: true, record, message: "Batch removed from the directory. Existing classes are preserved." });
});
export const writeOnlineDirectory = respond(async (req, res) => {
  const record = await saveDirectoryItem(req.params.kind, req.params.id || null, req.body);
  await createAuditLog({ req, actorType: "ADMIN", actorId: req.user.id, actorName: req.user.name, action: "ONLINE_CLASS_DIRECTORY_UPDATED", entityType: req.params.kind === "batch" ? "OnlineClassBatch" : "OnlineClassGrade", entityId: record.id, metadata: { name: record.name, isActive: record.isActive } }).catch(error => console.warn("Online class directory audit failed", { code: error.code, name: error.name }));
  res.json({ success: true, record });
});
export const manageAdminOnlineClass = respond(async (req, res) => {
  const row = await prisma.facultyOnlineClass.findUnique({ where: { id: req.params.id }, select: { facultyId: true } });
  if (!row) return res.status(404).json({ success: false, message: "Class not found." });
  const action = req.method === "DELETE" ? "delete" : req.method === "PATCH" ? "edit" : req.params.action;
  if (!["delete", "edit", "cancel", "check"].includes(action)) return res.status(400).json({ success: false, message: "Invalid class action." });
  if (action === "delete") {
    const result = await deleteFacultyOnlineClass(row.facultyId, req.params.id, prisma, { type: "ADMIN", id: req.user.id });
    if (!result.alreadyDeleted) await audit(req, { id: req.params.id, status: "DELETED" }, "ONLINE_CLASS_DELETED");
    return res.json({ success: true, ...result });
  }
  const record = action === "edit" ? await saveOnlineClass(row.facultyId, req.body, req.params.id) : action === "check" ? await checkOnlineMeeting(req.params.id, row.facultyId) : await transitionOnlineClass(row.facultyId, req.params.id, action);
  await audit(req, record, `ONLINE_CLASS_ADMIN_${action.toUpperCase()}`);
  res.json({ success: true, record });
});

export const downloadOnlineAttendance = respond(async (req, res) => {
  const row = await getMeetingAttendance(req.params.id, { id: req.user.id, role: req.userRole });
  const pdf = await buildMeetAttendancePdf(row);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="online-class-${row.id}-attendance.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(pdf);
});
