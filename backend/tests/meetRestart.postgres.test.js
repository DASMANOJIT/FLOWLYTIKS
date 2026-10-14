import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("Meet worker process crash retains evidence and recovers exactly once after lease expiry", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true", timeout: 30000 }, async () => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const children = [];
  const id = randomUUID(), now = new Date();
  const faculty = await db.faculty.create({ data: { id, facultyId: `RESTART_${id}`, username: id, passwordHash: "TEST_LOGIN_DISABLED", fullName: "Restart Teacher", phone: id, joiningDate: now, salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } });
  const type = await db.extraIncentiveType.create({ data: { name: `Restart ${id}`, rate: 219 } });
  await db.facultyGoogleConnection.create({ data: { facultyId: id, googleSubject: "teacher", identityVerifiedAt: new Date(+now - 7200000), scope: "openid https://www.googleapis.com/auth/meetings.space.readonly", connectedAt: new Date(+now - 7200000) } });
  const code = id.replaceAll("-", "").slice(0, 10).replace(/[0-9]/g, digit => String.fromCharCode(97 + Number(digit)));
  const row = await db.facultyOnlineClass.create({ data: { facultyId: faculty.id, incentiveTypeId: type.id, requestId: randomUUID(), batchName: "Restart batch", className: "", topic: "Restart test", startsAt: new Date(+now - 3600000), endsAt: new Date(+now - 1800000), meetUrl: `https://meet.google.com/${code.slice(0, 3)}-${code.slice(3, 7)}-${code.slice(7)}`, trackingEnabled: true, createdAt: new Date(+now - 7200000) } });
  const run = (mode, clock) => new Promise((resolve, reject) => {
    const child = fork(new URL("./meetRestartProcess.js", import.meta.url), [], { execArgv: [], env: { ...process.env, DATABASE_URL: "" }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    children.push(child);
    let result;
    child.on("error", reject);
    child.on("message", message => {
      if (message.ready) child.send({ id: row.id, mode, now: clock.toISOString() });
      if (message.evidenceSaved) { result = "crashed"; child.kill("SIGKILL"); }
      if (message.result) result = message.result;
    });
    child.on("exit", (code, signal) => result === "crashed" && signal === "SIGKILL" || code === 0 && result ? resolve(result) : reject(new Error("Isolated Meet worker failed")));
  });
  try {
    assert.equal(await run("crash", now), "crashed");
    const interrupted = await db.facultyOnlineClass.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(interrupted.conferenceName, `conferenceRecords/restart-${row.id}`);
    assert.ok(interrupted.attendanceEvidence.conference.endTime);
    assert.ok(interrupted.pollLeaseToken);
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId: id } }), 0);
    assert.equal((await run("recover", now)).pending, true, "Restart must not steal an unexpired lease");
    // Advance only the injected test clock, not application data or production timeouts.
    const recovered = await run("recover", new Date(+interrupted.pollLeaseUntil + 1));
    assert.equal(recovered.status, "COMPLETED");
    const saved = await db.facultyOnlineClass.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(saved.verificationStatus, "VERIFIED");
    assert.equal(saved.pollLeaseToken, null);
    assert.equal(saved.conferenceName, interrupted.conferenceName);
    await run("recover", new Date(+interrupted.pollLeaseUntil + 2));
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId: id } }), 1);
    assert.equal(Number((await db.facultyExtraIncentiveEntry.findUniqueOrThrow({ where: { id: saved.incentiveEntryId } })).amountSnapshot), 219);
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, "exit"); }
    await db.$disconnect();
  }
});
