import "./setupDisposableDatabase.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import express from "express";
import jwt from "jsonwebtoken";
import db from "../prisma/client.js";
import { addSession } from "../utils/sessionStore.js";

test("bounded persisted 100-participant PDF exports alongside real heartbeat requests", { timeout: 30000 }, async () => {
  let server;
  try {
    const id = randomUUID(), now = new Date();
    const admin = await db.admin.create({ data: { name: "Synthetic Export Admin", email: `p4-export-${id}@example.invalid`, password: "LOGIN_DISABLED" } });
    const faculty = await db.faculty.create({ data: { facultyId: `P4PDF_${id}`, username: id, passwordHash: "LOGIN_DISABLED", fullName: "Synthetic PDF Teacher", phone: id, joiningDate: now, salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } });
    const type = await db.extraIncentiveType.create({ data: { name: `P4 PDF ${id}`, rate: 200 } });
    const start = new Date(+now - 3600000), end = new Date(+now - 1800000);
    const row = await db.facultyOnlineClass.create({ data: { facultyId: faculty.id, incentiveTypeId: type.id, requestId: id, topic: "Synthetic PDF performance", batchName: "Synthetic batch", className: "", startsAt: start, endsAt: end, meetUrl: "https://meet.google.com/pdf-test-aaa", status: "COMPLETED", actualStartAt: start, actualEndAt: end, attendanceCompleteAt: now, verificationStatus: "TEACHER_IDENTITY_REVIEW", attendanceEvidence: { summary: { complete: true, totalParticipants: 100, excludingTeacher: null, participants: Array.from({ length: 100 }, (_, i) => ({ displayName: `Synthetic Participant ${i}`, googleUserId: `users/synthetic${i}`, durationSeconds: 1800 })) } } } });
    const jti = randomUUID(); await addSession("admin", admin.id, jti, +now + 600000);
    const headers = { Authorization: `Bearer ${jwt.sign({ role: "admin", id: admin.id, jti }, process.env.JWT_SECRET, { expiresIn: "10m" })}` };
    const app = express(); app.use("/api/auth", (await import("../routes/authroute.js")).default); app.use("/api/faculty-extra-incentives", (await import("../routes/facultyextraincentiveroute.js")).default);
    server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`, heartbeats = [], exports = [];
    const request = async (path, pdf = false) => {
      const start = performance.now(), response = await fetch(base + path, { headers, signal: AbortSignal.timeout(15000) });
      const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(response.status, 200);
      if (pdf) assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      return { ms: performance.now() - start, bytes: bytes.length };
    };
    const cold = await request(`/api/faculty-extra-incentives/online-classes/${row.id}/attendance.pdf`, true);
    await Promise.all([
      (async () => { for (let i = 0; i < 5; i++) { exports.push(await request(`/api/faculty-extra-incentives/online-classes/${row.id}/attendance.pdf`, true)); await new Promise(resolve => setTimeout(resolve, 100)); } })(),
      (async () => { for (let i = 0; i < 30; i++) { heartbeats.push(await request("/api/auth/heartbeat")); await new Promise(resolve => setTimeout(resolve, 40)); } })(),
    ]);
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId: faculty.id } }), 0, "Export cannot credit an incentive");
    const result = { participants: 100, cold, exports, heartbeats };
    console.log("phase4.exports", JSON.stringify(result));
    if (process.env.PHASE4_OUTPUT?.startsWith("/tmp/flowlytiks-phase4-")) await writeFile(`${process.env.PHASE4_OUTPUT}/exports.json`, JSON.stringify(result, null, 2));
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await db.$disconnect(); }
});
