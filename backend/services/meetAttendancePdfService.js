import PDFDocument from "pdfkit";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import prisma from "../prisma/client.js";
import { onlineClassBatchNames } from "./facultyOnlineClassService.js";

export async function getMeetingAttendance(id, actor, db = prisma, now = new Date()) {
  if (!["faculty", "admin"].includes(actor.role)) throw Object.assign(new Error("Faculty or Admin access required."), { status: 403 });
  const row = await db.facultyOnlineClass.findFirst({ where: { id, ...(actor.role === "faculty" ? { facultyId: actor.id } : {}) }, include: { batches: true, faculty: { select: { fullName: true, facultyId: true } } } });
  if (!row) throw Object.assign(new Error("Class not found."), { status: 404 });
  if (!row.actualEndAt || row.actualEndAt > now || !row.attendanceCompleteAt || !row.attendanceEvidence?.summary?.complete) throw Object.assign(new Error("Complete verified Google attendance data is not available yet."), { status: 409 });
  return row;
}

const ist = value => value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST" : "Not available";
const duration = seconds => `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
export function buildMeetAttendancePdf(row) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    const font = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/public/fonts/NotoSans-Regular.ttf");
    if (fs.existsSync(font)) doc.font(font);
    const summary = row.attendanceEvidence.summary;
    doc.fillColor("#2563eb").fontSize(21).text("Flowlytiks");
    doc.fillColor("#14263d").fontSize(16).text("Online Doubt Class Attendance").moveDown(0.6);
    const details = [
      ["Teacher", `${row.faculty.fullName} (${row.faculty.facultyId})`], ["Batches", onlineClassBatchNames(row).join(", ")], ...(row.className ? [["Legacy Class / Grade", row.className]] : []),
      ["Topic", row.topic], ["Meet link", row.meetUrl], ["Conference", row.conferenceName],
      ["Scheduled start", ist(row.startsAt)], ...(row.endsAt ? [["Historical scheduled end", ist(row.endsAt)]] : []), ["Actual start", ist(row.actualStartAt)], ["Actual end", ist(row.actualEndAt)],
      ["Actual duration", duration((row.actualEndAt - row.actualStartAt) / 1000)], ["Participants", String(summary.totalParticipants)],
      ["Excluding teacher", summary.excludingTeacher == null ? "Unavailable: teacher identity not verified" : String(summary.excludingTeacher)],
      ["Verification", row.verificationStatus], ["Evidence retrieved", ist(row.attendanceCompleteAt)],
    ];
    doc.fontSize(9);
    for (const [label, value] of details) doc.fillColor("#334155").text(`${label}: ${value}`).moveDown(0.25);
    doc.moveDown(0.6).fillColor("#334155").text("Google-reported participants, not a registered-student attendance list. Display names are supplied by Google. Unknown identities are not inferred.").moveDown(0.8);
    if (row.verificationStatus !== "VERIFIED") doc.fillColor("#9a3412").text("Evidence retained for review. This report does not prove incentive eligibility.").moveDown(0.7);
    const header = () => {
      const y = doc.y;
      doc.rect(40, y, 515, 26).fill("#eaf2ff"); doc.fillColor("#14263d").fontSize(9);
      doc.text("Participant / Google identifier", 48, y + 6, { width: 375 }); doc.text("Attendance", 439, y + 6, { width: 108 }); doc.y = y + 32;
    };
    header();
    for (const participant of summary.participants) {
      const text = `${participant.displayName}\n${participant.googleUserId || "Anonymous/phone identity"}`;
      const height = Math.max(40, doc.heightOfString(text, { width: 375 }) + 12);
      if (doc.y + height > doc.page.height - 65) { doc.addPage(); header(); }
      const y = doc.y;
      doc.fillColor("#14263d").text(text, 48, y, { width: 375 }); doc.text(duration(participant.durationSeconds), 439, y, { width: 108 });
      doc.moveTo(40, y + height - 5).lineTo(555, y + height - 5).strokeColor("#e2e8f0").stroke(); doc.y = y + height;
    }
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) { doc.switchToPage(i); doc.fillColor("#64748b").fontSize(8).text(`Flowlytiks | Google Meet evidence | ${i + 1} / ${pages.count}`, 40, doc.page.height - 40, { lineBreak: false }); }
    doc.end();
  });
}
