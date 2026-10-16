import test from "node:test";
import assert from "node:assert/strict";
import { validateOnlineClass, saveOnlineClass, transitionOnlineClass, listOnlineClasses } from "../services/facultyOnlineClassService.js";

const body = { batchIds: ["batch-one", "batch-two"], topic: "Algebra", date: "2026-10-09", startTime: "17:00", endTime: "18:00", meetUrl: "https://meet.google.com/abc-defg-hij", message: "Bring questions.", incentiveTypeId: "type-one", requestId: "request-unique-one", facultyId: "spoofed" };
function database() {
  const rows = [], entries = [];
  const faculty = { fullName: "Database Teacher", facultyId: "FAC_TEST" };
  const type = { id: "type-one", name: "ONLINE DOUBT CLASS", rate: 237.5, isActive: true };
  const attach = row => row && ({ ...row, faculty, incentiveEntry: entries.find(entry => entry.id === row.incentiveEntryId) || null });
  let queue = Promise.resolve();
  const db = {
    rows, entries, type,
    $queryRaw: async query => (query.strings || query).join("").includes('FROM "OnlineClassBatch"') ? [{ id: "batch-one", name: "Existing Batch", isActive: true }, { id: "batch-two", name: "Second Batch", isActive: true }] : [],
    extraIncentiveType: { findFirst: async () => type, findUnique: async () => type },
    facultyOnlineClass: {
      findUnique: async ({ where }) => attach(rows.find(row => row.facultyId === where.facultyId_requestId.facultyId && row.requestId === where.facultyId_requestId.requestId)),
      findFirst: async ({ where }) => attach(rows.find(row => Object.entries(where).every(([key, value]) => row[key] === value))),
      findMany: async ({ where, skip, take }) => rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value)).slice(skip, skip + take).map(attach),
      create: async ({ data }) => { const row = { id: `class-${rows.length}`, status: "SCHEDULED", updatedAt: new Date(), ...data, batches: data.batches.create }; rows.push(row); return attach(row); },
      update: async ({ where, data }) => { const row = rows.find(row => row.id === where.id); Object.assign(row, data, { updatedAt: new Date() }, data.batches ? { batches: data.batches.create } : {}); return attach(row); },
    },
    facultyExtraIncentiveEntry: { create: async ({ data }) => { const entry = { id: `entry-${entries.length}`, ...data }; entries.push(entry); return entry; } },
    $transaction: work => { const next = queue.then(() => work(db)); queue = next.catch(() => {}); return next; },
  };
  return db;
}

test("IST validation uses class date, rejects invalid dates, time ranges and Meet URLs", () => {
  assert.equal(validateOnlineClass(body).startsAt.toISOString(), "2026-10-09T11:30:00.000Z");
  for (const change of [{ endTime: "16:00" }, { date: "2026-02-30" }, { startTime: "25:00" }, { topic: " " }, { meetUrl: "http://meet.google.com/abc-defg-hij" }, { meetUrl: "https://meet.google.com.evil.test/abc-defg-hij" }, { meetUrl: "https://user@meet.google.com/abc-defg-hij" }]) assert.throws(() => validateOnlineClass({ ...body, ...change }));
});

test("new sessions need no scheduled end; editing preserves a historical end without submitting it", async () => {
  const { endTime, ...withoutEnd } = body;
  assert.equal(endTime, "18:00");
  assert.equal(validateOnlineClass(withoutEnd).endsAt, undefined);
  const db = database();
  const fresh = await saveOnlineClass("faculty-one", withoutEnd, null, db);
  assert.equal(fresh.endsAt, undefined);
  assert.doesNotMatch(fresh.announcement, /18:00/);
  const legacy = await saveOnlineClass("faculty-one", { ...body, requestId: "legacy-scheduled-one" }, null, db);
  const edited = await saveOnlineClass("faculty-one", { ...withoutEnd, date: "2026-10-10", expectedUpdatedAt: legacy.updatedAt.toISOString() }, legacy.id, db);
  assert.equal(+edited.endsAt, +legacy.endsAt);
  assert.equal(edited.startsAt.toISOString(), "2026-10-10T11:30:00.000Z");
});

test("save owns faculty identity, retries one class, announcement adds no incentive", async () => {
  const db = database();
  const result = await saveOnlineClass("faculty-one", body, null, db);
  await saveOnlineClass("faculty-one", body, null, db);
  assert.equal(result.facultyId, "faculty-one"); assert.equal(result.teacherName, "Database Teacher");
  assert.match(result.announcement, /IST/); assert.match(result.announcement, /Bring questions/);
  assert.equal(db.rows.length, 1); assert.equal(db.entries.length, 0);
  assert.deepEqual(result.batchIds, body.batchIds); assert.match(result.announcement, /Existing Batch, Second Batch/);
});

test("manual completion is blocked; legacy paid entries remain unchanged", async () => {
  const db = database();
  const legacy = { id: "legacy", amountSnapshot: 90, quantityChange: 1, status: "PAID" }; db.entries.push(legacy);
  const row = await saveOnlineClass("faculty-one", body, null, db);
  await assert.rejects(transitionOnlineClass("other-faculty", row.id, "complete", db), error => error.status === 404);
  await assert.rejects(transitionOnlineClass("faculty-one", row.id, "complete", db, new Date("2026-10-09T12:29:59Z")), error => error.status === 409);
  await assert.rejects(transitionOnlineClass("faculty-one", row.id, "complete", db), error => error.status === 409);
  assert.equal(db.entries.length, 1);
  assert.deepEqual(db.entries[0], legacy);
  db.rows[0].status = "COMPLETED"; db.rows[0].incentiveEntryId = legacy.id;
  await assert.rejects(transitionOnlineClass("faculty-one", row.id, "cancel", db), error => error.status === 409);
  await assert.rejects(saveOnlineClass("faculty-one", { ...body, expectedUpdatedAt: row.updatedAt.toISOString() }, row.id, db), error => error.status === 409);
});

test("scheduled classes can be edited/cancelled but cancelled classes cannot earn", async () => {
  const db = database(); const row = await saveOnlineClass("faculty-one", body, null, db);
  await assert.rejects(saveOnlineClass("faculty-one", { ...body, expectedUpdatedAt: "stale" }, row.id, db), error => error.status === 409);
  const changed = await saveOnlineClass("faculty-one", { ...body, topic: "Updated Topic", expectedUpdatedAt: row.updatedAt.toISOString() }, row.id, db);
  assert.equal(changed.topic, "Updated Topic");
  await transitionOnlineClass("faculty-one", row.id, "cancel", db);
  await assert.rejects(transitionOnlineClass("faculty-one", row.id, "complete", db), error => error.status === 409);
  assert.equal(db.entries.length, 0);
  assert.equal((await listOnlineClasses({ facultyId: "other-faculty" }, db)).records.length, 0);
});

test("scheduled edits cannot replace matched evidence or credited legacy accounting", async () => {
  const db = database(); const row = await saveOnlineClass("faculty-one", body, null, db);
  db.rows[0].conferenceName = "conferenceRecords/retained";
  await assert.rejects(saveOnlineClass("faculty-one", { ...body, topic: "Changed", expectedUpdatedAt: row.updatedAt.toISOString() }, row.id, db), { status: 409 });
  assert.equal(db.rows[0].topic, "Algebra"); assert.equal(db.rows[0].conferenceName, "conferenceRecords/retained");
  db.rows[0].conferenceName = null; db.rows[0].incentiveEntryId = "retained-paid-entry";
  await assert.rejects(saveOnlineClass("faculty-one", { ...body, expectedUpdatedAt: row.updatedAt.toISOString() }, row.id, db), /Credited classes/);
});
