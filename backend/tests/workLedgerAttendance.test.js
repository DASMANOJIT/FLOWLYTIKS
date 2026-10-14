import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../prisma/client.js";
import { exportWorkLedgerReport, exportWorkLedgerCsv, updateWorkLedgerAttendanceEntry, updateWorkLedgerEntry, deleteWorkLedgerEntry, getWorkLedgerEntries } from "../controllers/workledgercontrollers.js";

const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; }, setHeader() {} });
const entry = { id: "entry-test", facultyId: "faculty-test", date: new Date("2026-10-10T00:00:00Z"), shift: "DAILY", amount: 400, faculty: { id: "faculty-test", facultyId: "FAC001", fullName: "Test Faculty" }, updatedByRole: "FACULTY", updatedAt: new Date("2026-10-10T10:00:00Z") };
const replace = (t, target, method, implementation) => {
  const original = target[method];
  target[method] = implementation;
  t.after(() => { target[method] = original; });
};

test("missing ledger schema is an error, not a successful empty week", async t => {
  replace(t, prisma.workLedgerEntry, "findMany", async () => { throw Object.assign(new Error("Missing ledger table"), { code: "P2021" }); });
  const res = response();
  await getWorkLedgerEntries({ userRole: "admin", headers: {}, query: { week: "2026-10-09" } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.success, false);
  assert.equal(res.body.entries, undefined);
});

test("exports fetch all week records ignoring pagination and hidden filters, retain overrides and totals", async t => {
  const entries = Array.from({ length: 1005 }, (_, index) => ({ ...entry, id: String(index), amount: index ? 400 : 375, updatedByRole: index ? "FACULTY" : "ADMIN" }));
  replace(t, prisma.workLedgerEntry, "findMany", async query => {
    assert.equal(query.take, undefined);
    assert.deepEqual(Object.keys(query.where), ["date"]);
    return entries;
  });
  const req = { userRole: "admin", query: { week: "2026-10-09", limit: 1, facultyId: "other", shift: "EVENING" } };
  const json = response(); await exportWorkLedgerReport(req, json);
  assert.equal(json.body.entries.length, 1005);
  assert.equal(json.body.summary.totalAmount, 401975);
  assert.equal(json.body.days.length, 7);
  assert.equal(json.body.entries[0].updatedByRole, "ADMIN");
  const csv = response(); await exportWorkLedgerCsv(req, csv);
  assert.match(csv.body, /"2026-10-09","2026-10-15","TOTAL".*"401975"/);
  assert.match(csv.body, /"DAILY TOTAL"/);
  assert.match(csv.body, /"ADMIN"/);
});

test("export authorization rejects Faculty, Staff and Student", async () => {
  for (const userRole of ["faculty", "staff", "student"]) {
    for (const handler of [exportWorkLedgerCsv, exportWorkLedgerReport]) {
      const res = response(); await handler({ userRole, query: {} }, res);
      assert.equal(res.statusCode, 403);
    }
  }
});

test("weekly read totals include daily and legacy amounts beyond the previous row cap", async t => {
  replace(t, prisma.workLedgerEntry, "findMany", async query => { assert.equal(query.take, undefined); return Array.from({ length: 1001 }, (_, i) => ({ ...entry, id: String(i), shift: i ? "MORNING" : "DAILY", amount: i ? 123 : 375 })); });
  for (const model of [prisma.payrollCycle, prisma.facultyPayout, prisma.weeklyFacultyPaymentRecord]) replace(t, model, "findFirst", async () => null);
  const res = response(); await getWorkLedgerEntries({ userRole: "admin", headers: {}, query: { week: "2026-10-09", limit: 1 } }, res);
  assert.equal(res.body.entries.length, 1001);
  assert.equal(res.body.summary.totalAmount, 123375);
  assert.equal(res.body.days.reduce((sum, day) => sum + day.dailyTotal, 0), 123375);
});

test("admin overrides update stored amount, audit and editable draft totals", async t => {
  let saved = { ...entry };
  const audits = [], draftUpdates = [];
  const tx = {
    $executeRaw: async () => {},
    payrollCycle: { findFirst: async () => null }, facultyPayout: { findFirst: async () => null }, weeklyFacultyPaymentRecord: { findFirst: async () => null },
    workLedgerEntry: { findUnique: async () => saved, update: async ({ data }) => { saved = { ...saved, ...data }; return saved; }, findMany: async () => [saved] },
    workLedgerEntryAudit: { create: async ({ data }) => { audits.push(data); } },
    facultyEarningsPayroll: { updateMany: async query => { draftUpdates.push(query); } },
  };
  replace(t, prisma.workLedgerEntry, "findUnique", async () => saved);
  replace(t, prisma, "$transaction", async work => work(tx));
  const req = { userRole: "admin", user: { id: 1, name: "Admin" }, params: { attendanceId: entry.id }, body: { amount: 375, remarks: "Admin override" } };
  const res = response(); await updateWorkLedgerAttendanceEntry(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(saved.amount, 375);
  assert.equal(saved.updatedByRole, "ADMIN");
  assert.equal(audits[0].previousData.amount, 400);
  assert.equal(draftUpdates[0].data.totalAmount, 375);
  const remarksOnly = response(); await updateWorkLedgerAttendanceEntry({ ...req, body: { remarks: "Reviewed" } }, remarksOnly);
  assert.equal(saved.amount, 375);
});

test("faculty cannot override or remove another faculty's ledger entry", async t => {
  replace(t, prisma.workLedgerEntry, "findUnique", async () => entry);
  const res = response(); await updateWorkLedgerEntry({ userRole: "faculty", user: { id: entry.facultyId }, params: { id: entry.id }, body: { facultyId: entry.facultyId, date: entry.date, shift: "DAILY", amount: 1 } }, res);
  assert.equal(res.statusCode, 400);
  const removal = response(); await deleteWorkLedgerEntry({ userRole: "faculty", user: { id: "other" }, params: { id: entry.id } }, removal);
  assert.equal(removal.statusCode, 403);
});
