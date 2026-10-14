import test from "node:test";
import assert from "node:assert/strict";
const { getStaffPaymentInfo, recordStaffCashPayment } = await import("../services/staffPaymentService.js");

function fixture() {
  const state = { payment: null, gateway: null, acquired: true, writes: 0, audit: null };
  const tx = {
    student: { findUnique: async () => ({ id: 77, name: "Test Student", class: "8", phone: "contact" }) },
    appSettings: { findUnique: async () => ({ monthlyFee: 600 }) },
    payment: { findUnique: async () => state.payment },
    paymentGatewayOrder: { findFirst: async () => state.gateway },
    auditLog: { create: async ({ data }) => { state.audit = data; } },
    $queryRaw: async () => [{ acquired: state.acquired }],
  };
  const db = { ...tx, $transaction: async (work, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    const previous = state.payment;
    try { return await work(tx); } catch (error) { state.payment = previous; throw error; }
  } };
  const record = async (args) => {
    assert.equal(args.monthlyFee, 600);
    assert.equal(args.adminId, null);
    assert.equal(args.runPostPaymentActions, false);
    state.writes++;
    state.payment = { id: 134, status: "paid", paymentProvider: "CASH", paidAt: new Date() };
    return { outcome: "created", payment: state.payment };
  };
  const req = { params: { studentId: "77" }, body: { month: "June", academicYear: 2026, cashReceived: true, amount: 1, staffId: "forged" }, user: { id: "actual-staff", name: "Test Staff" }, headers: {}, ip: "127.0.0.1" };
  return { state, tx, db, record, req };
}

test("Staff cash uses server fee and session attribution in the shared payment ledger", async () => {
  const f = fixture();
  const result = await recordStaffCashPayment(f.req, f.db, f.record);
  assert.equal(result.success, true);
  assert.equal(result.amount, 600);
  assert.equal(f.state.audit.actorId, "actual-staff");
  assert.equal(f.state.audit.metadataJson.method, "CASH");
  assert.equal(f.state.audit.entityId, "134");
  await assert.rejects(recordStaffCashPayment(f.req, f.db, f.record), { status: 409, code: "ALREADY_PAID" });
  assert.equal(f.state.writes, 1);
});

test("An unverified UTR is never accepted as a payment", async () => {
  const f = fixture();
  const info = await getStaffPaymentInfo("77", f.req.body, f.db);
  assert.equal(info.onlineVerificationAvailable, false);
  assert.equal(info.paymentStatus, "Unpaid");
  assert.equal(info.existing, undefined);
  assert.equal(f.state.writes, 0);
  f.req.body = { ...f.req.body, cashReceived: false, utr: "unverified" };
  await assert.rejects(recordStaffCashPayment(f.req, f.db, f.record), { status: 400 });
});

test("Staff cash refuses concurrent locks and unresolved gateway records", async () => {
  const f = fixture();
  f.state.acquired = false;
  await assert.rejects(recordStaffCashPayment(f.req, f.db, f.record), { code: "PAYMENT_BUSY" });
  f.state.acquired = true;
  f.state.gateway = { id: "order" };
  await assert.rejects(recordStaffCashPayment(f.req, f.db, f.record), { code: "ONLINE_PAYMENT_PENDING" });
  f.state.gateway = null;
  f.state.payment = { status: "created", phonepeTransactionId: "pending-online" };
  await assert.rejects(recordStaffCashPayment(f.req, f.db, f.record), { code: "ONLINE_PAYMENT_PENDING" });
  assert.equal(f.state.writes, 0);
});

test("Invalid periods and missing students fail without writing", async () => {
  const f = fixture();
  f.req.body.month = "Invalid";
  await assert.rejects(recordStaffCashPayment(f.req, f.db, f.record), { status: 400 });
  f.req.body.month = "June";
  f.tx.student.findUnique = async () => null;
  await assert.rejects(recordStaffCashPayment(f.req, f.db, f.record), { status: 404 });
  assert.equal(f.state.writes, 0);
});

test("Audit failure rolls back the payment rather than reporting success", async () => {
  const f = fixture();
  f.tx.auditLog.create = async () => { throw new Error("Audit unavailable"); };
  await assert.rejects(recordStaffCashPayment(f.req, f.db, f.record), /Audit unavailable/);
  assert.equal(f.state.payment, null);
});

test("Serialization conflicts retry and recheck paid status", async () => {
  const f = fixture();
  const transaction = f.db.$transaction;
  let calls = 0;
  f.db.$transaction = async (...args) => {
    if (++calls === 1) throw Object.assign(new Error("Conflict"), { code: "P2034" });
    return transaction(...args);
  };
  await recordStaffCashPayment(f.req, f.db, f.record);
  assert.equal(calls, 2);
  assert.equal(f.state.writes, 1);
});

test("Repeated unique conflicts return an accurate payment error", async () => {
  const f = fixture();
  f.db.$transaction = async () => { throw Object.assign(new Error("Unique conflict"), { code: "P2002" }); };
  await assert.rejects(recordStaffCashPayment(f.req, f.db, f.record), { status: 409, code: "PAYMENT_CONFLICT" });
});

test("Staff tokens cannot access Admin cash reversal or unrelated payment APIs", async () => {
  const { default: jwt } = await import("jsonwebtoken");
  const { protect } = await import("../middleware/authmiddleware.js");
  process.env.JWT_SECRET ||= "unit-test-only-secret";
  const token = jwt.sign({ id: "staff-test", role: "staff" }, process.env.JWT_SECRET, { expiresIn: "5m" });
  for (const path of ["/api/payments/reverse", "/api/payments/mark-unpaid", "/api/payments/revenue", "/api/faculty/dashboard"]) {
    const res = { statusCode: 0, status(code) { this.statusCode = code; return this; }, json() { return this; } };
    await protect({ headers: { authorization: `Bearer ${token}` }, originalUrl: path }, res, () => assert.fail("Staff must not access this route"));
    assert.equal(res.statusCode, 403);
  }
});
