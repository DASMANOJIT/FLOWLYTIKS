import test from "node:test";
import assert from "node:assert/strict";
import { createStaffFollowUp, readStaffFollowUps } from "../services/staffFollowUpService.js";

test("Follow-up creation derives author from session and returns no history", async () => {
  const db = { student: { findUnique: async ({ where }) => { assert.equal(where.id, 77); return { id: 77 }; } }, staffStudentFollowUp: { create: async ({ data, select }) => {
    assert.deepEqual(data, { studentId: 77, staffId: "session-staff", note: "Parent will call back" });
    assert.deepEqual(select, { id: true });
    return { id: "note" };
  } } };
  const result = await createStaffFollowUp("session-staff", "77", " Parent will call back ", db);
  assert.equal(result.success, true);
  assert.deepEqual(Object.keys(result).sort(), ["message", "success"]);
});
test("Invalid, empty and oversized notes fail without writing", async () => {
  for (const note of [null, 5, " ", "x".repeat(4001)]) await assert.rejects(createStaffFollowUp("staff", "77", note, {}), { status: 400 });
  for (const id of ["0", "bad", "2147483648"]) await assert.rejects(readStaffFollowUps(id, {}), { status: 400 });
  await assert.rejects(createStaffFollowUp("staff", "77", "Note", { student: { findUnique: async () => null } }), { status: 404 });
});
test("Failed database writes cannot return success", async () => {
  await assert.rejects(createStaffFollowUp("staff", "77", "Note", { student: { findUnique: async () => ({ id: 77 }) }, staffStudentFollowUp: { create: async () => { throw Error("Unavailable"); } } }), /Unavailable/);
});
test("History is filtered by exact student and has only permitted fields", async () => {
  await readStaffFollowUps("77", { student: { findUnique: async () => ({ id: 77 }) }, staffStudentFollowUp: { findMany: async (query) => {
    assert.deepEqual(query.where, { studentId: 77 });
    assert.deepEqual(query.select, { id: true, note: true, createdAt: true, staff: { select: { name: true } } });
    assert.deepEqual(query.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
    return [];
  } } });
});
test("Timeline cursor pagination has stable newest-first ordering", async () => {
  const db = { student: { findUnique: async () => ({ id: 77 }) }, staffStudentFollowUp: { findMany: async (query) => {
    assert.equal(query.take, 31); assert.equal(query.skip, 1);
    assert.deepEqual(query.cursor, { id: "cursor" });
    assert.deepEqual(query.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
    return [];
  } } };
  await readStaffFollowUps("77", db, { limit: "30", cursor: "cursor" });
  await assert.rejects(readStaffFollowUps("77", db, { limit: "101" }), { status: 400 });
});
