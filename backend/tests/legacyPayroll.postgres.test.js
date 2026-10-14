import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("legacy payroll mutations preserve paid/processing state, serialize processing and roll back failures", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { addSession } = await import("../utils/sessionStore.js");
  const app = express(); app.use(express.json());
  app.use("/payroll", (await import("../routes/facultypayrollroute.js")).default);
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const id = randomUUID();
  const faculty = await db.faculty.create({ data: { facultyId: id, username: id, passwordHash: "TEST_LOGIN_DISABLED", fullName: "Legacy payroll fixture", phone: id, joiningDate: new Date(), salaryType: "ATTENDANCE_BASED" } });
  const users = { admin: await db.admin.create({ data: { name: "Isolated payroll admin", email: `${id}@example.invalid`, password: "TEST_LOGIN_DISABLED" } }), faculty, staff: await db.staff.findFirstOrThrow({ where: { isActive: true } }), student: await db.student.findFirstOrThrow() };
  const tokens = {};
  for (const [role, user] of Object.entries(users)) { const jti = randomUUID(); await addSession(role, user.id, jti, Date.now() + 600000); tokens[role] = jwt.sign({ role, id: user.id, jti }, process.env.JWT_SECRET, { expiresIn: "10m" }); }
  const call = async (action, body, role = "admin") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/payroll/${action}`, { method: "POST", headers: { "Content-Type": "application/json", ...(tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const fixture = async status => {
    const startDate = new Date(Date.now() + Math.floor(Math.random() * 1e12));
    return db.payrollCycle.create({ data: { cycleNumber: randomUUID(), startDate, endDate: new Date(+startDate + 6 * 86400000), status, ledgerLocked: true, payrolls: { create: { facultyId: faculty.id, totalEntries: 1, totalAmount: 321, status } } }, include: { payrolls: true } });
  };
  const original = db.$transaction.bind(db);
  try {
    const paid = await fixture("PAID");
    const before = JSON.stringify(await db.payrollCycle.findUnique({ where: { id: paid.id }, include: { payrolls: true } }));
    for (const action of ["approve", "process", "reject", "unlock", "initiate-payout"]) {
      for (const role of [null, "faculty", "staff", "student"]) assert.equal((await call(action, { payrollCycleId: paid.id, role: "admin" }, role)).status, role ? 403 : 401);
      assert.equal((await call(action, {})).status, 400);
    }
    assert.equal(JSON.stringify(await db.payrollCycle.findUnique({ where: { id: paid.id }, include: { payrolls: true } })), before);
    for (const action of ["reject", "unlock", "approve", "process"]) assert.ok([400, 409].includes((await call(action, { payrollCycleId: paid.id })).status), `Paid cycle must reject ${action}`);
    assert.equal(JSON.stringify(await db.payrollCycle.findUnique({ where: { id: paid.id }, include: { payrolls: true } })), before);
    const pending = await fixture("APPROVED");
    await db.facultyPayout.create({ data: { facultyId: faculty.id, payrollId: pending.payrolls[0].id, amount: 321, status: "PROCESSING" } });
    for (const action of ["reject", "unlock", "process", "approve"]) assert.ok([400, 409].includes((await call(action, { payrollCycleId: pending.id })).status), `Active payout must reject ${action}`);
    const editable = await fixture("DRAFT");
    assert.equal((await call("reject", { payrollCycleId: editable.id, remarks: "Fixture rejection" })).status, 200);
    assert.equal((await call("unlock", { payrollCycleId: editable.id })).status, 200);
    assert.equal((await call("approve", { payrollCycleId: editable.id })).status, 200);
    db.$transaction = (work, options) => original(tx => work(new Proxy(tx, { get(target, key) {
      if (key === "payrollCycle") return new Proxy(target[key], { get(delegate, method) { return method === "update" ? async () => { throw new Error("Controlled final cycle failure"); } : delegate[method]; } });
      return target[key];
    } })), options);
    assert.equal((await call("process", { payrollCycleId: editable.id })).status, 500);
    db.$transaction = original;
    assert.equal((await db.facultyEarningsPayroll.findUniqueOrThrow({ where: { id: editable.payrolls[0].id } })).status, "APPROVED");
    assert.equal(await db.notification.count({ where: { facultyId: faculty.id, type: "PAYROLL_PAID" } }), 0);
    const results = await Promise.all(Array.from({ length: 3 }, () => call("process", { payrollCycleId: editable.id })));
    assert.equal(results.filter(result => result.status === 200).length, 1);
    assert.equal(await db.notification.count({ where: { facultyId: faculty.id, type: "PAYROLL_PAID" } }), 1);
    const settled = await db.facultyEarningsPayroll.findUniqueOrThrow({ where: { id: editable.payrolls[0].id } });
    assert.equal(settled.status, "PAID"); assert.equal(Number(settled.totalAmount), 321);
    assert.equal((await call("process", { payrollCycleId: editable.id })).status, 400);
    assert.equal((await db.facultyEarningsPayroll.findUniqueOrThrow({ where: { id: settled.id } })).paidAt.getTime(), settled.paidAt.getTime());
    const online = await fixture("APPROVED");
    await db.facultyBankAccount.create({ data: { facultyId: faculty.id, verificationStatus: "VERIFIED", payoutEligible: true, cashfreeBeneficiaryId: "isolated" } });
    process.env.CASHFREE_PAYOUT_CLIENT_ID = "isolated"; process.env.CASHFREE_PAYOUT_CLIENT_SECRET = "isolated";
    const fetchBefore = globalThis.fetch; let transfers = 0;
    globalThis.fetch = async (url, options) => {
      if (String(url).startsWith("http://127.0.0.1:")) return fetchBefore(url, options);
      assert.equal(String(url), "https://sandbox.cashfree.com/payout/transfers"); assert.equal(options.method, "POST");
      transfers++; return new Response(JSON.stringify({ status: "PENDING" }));
    };
    try {
      const initiated = await Promise.all([call("initiate-payout", { payrollCycleId: online.id }), call("initiate-payout", { payrollCycleId: online.id })]);
      assert.ok(initiated.every(result => result.status === 200));
      assert.equal(await db.facultyPayout.count({ where: { payrollId: online.payrolls[0].id } }), 1); assert.equal(transfers, 1);
      assert.equal((await call("unlock", { payrollCycleId: online.id })).status, 400);
    } finally { globalThis.fetch = fetchBefore; }
  } finally { db.$transaction = original; await new Promise(resolve => server.close(resolve)); await db.$disconnect(); }
});
