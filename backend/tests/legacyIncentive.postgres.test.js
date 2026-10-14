import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("legacy count adjustment validates identity/count, preserves history and handles concurrent replay", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { adjustMyIncentive } = await import("../controllers/facultyextraincentivecontrollers.js");
  const id = randomUUID();
  const faculty = await db.faculty.create({ data: { facultyId: id, username: id, passwordHash: "TEST_LOGIN_DISABLED", fullName: "Adjustment fixture", phone: id, joiningDate: new Date(), salaryType: "ATTENDANCE_BASED" } });
  const type = await db.extraIncentiveType.create({ data: { name: id, rate: 50 } });
  const run = async (body, role = "faculty") => { const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; await adjustMyIncentive({ method: "PATCH", userRole: role, user: faculty, params: { incentiveTypeId: type.id }, body, headers: {} }, res); return res; };
  try {
    for (const role of ["admin", "student", "staff", "anonymous"]) assert.equal((await run({ pendingCount: 2, expectedPendingCount: 0 }, role)).code, 403);
    for (const value of [-1, 1.5, "2", null]) assert.equal((await run({ pendingCount: value, expectedPendingCount: 0 })).code, 400);
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId: faculty.id } }), 0);
    const results = await Promise.all(Array.from({ length: 3 }, () => run({ pendingCount: 2, expectedPendingCount: 0, facultyId: "spoofed" })));
    assert.ok(results.every(result => [200, 409].includes(result.code)));
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId: faculty.id } }), 1);
    assert.equal((await run({ pendingCount: 2, expectedPendingCount: 0 })).code, 200);
    assert.equal((await run({ pendingCount: 3, expectedPendingCount: 0 })).code, 409);
    await db.extraIncentiveType.update({ where: { id: type.id }, data: { rate: 100 } });
    assert.equal((await run({ pendingCount: 1, expectedPendingCount: 2 })).code, 200);
    const entries = await db.facultyExtraIncentiveEntry.findMany({ where: { facultyId: faculty.id }, orderBy: { createdAt: "asc" } });
    assert.equal(entries.length, 2); assert.equal(entries[0].quantityChange, 2); assert.equal(Number(entries[0].amountSnapshot), 100);
    assert.equal(entries.reduce((sum, entry) => sum + entry.quantityChange, 0), 1);
    assert.equal(entries.reduce((sum, entry) => sum + Number(entry.amountSnapshot), 0), 50);
    assert.ok(entries.every(entry => entry.facultyId === faculty.id));
  } finally { await db.$disconnect(); }
});
