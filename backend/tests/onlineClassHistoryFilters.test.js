import test from "node:test";
import assert from "node:assert/strict";
import { isOnlineClassIncentiveEntryEligible, listOnlineClasses, onlineClassDto, onlineClassHistoryWhere } from "../services/facultyOnlineClassService.js";

test("date and date-search filters use a half-open IST calendar day", () => {
  const expected = { gte: new Date("2026-10-11T18:30:00Z"), lt: new Date("2026-10-12T18:30:00Z") };
  assert.deepEqual(onlineClassHistoryWhere({ date: "2026-10-12" }).startsAt, expected);
  for (const search of ["2026-10-12", "12/10/2026", "12 Oct 2026", "12 OCTOBER 2026"]) {
    assert.deepEqual(onlineClassHistoryWhere({ search }).OR.find(item => item.startsAt).startsAt, expected);
  }
  assert.equal(onlineClassHistoryWhere({ search: "Java" }).OR[0].topic.mode, "insensitive");
  assert.throws(() => onlineClassHistoryWhere({ date: "2026-02-30" }), /Invalid class date/);
  assert.throws(() => onlineClassHistoryWhere({ search: [] }), /Invalid history filter/);
});

test("combined filters and aggregate queries retain faculty scope across all history pages", async () => {
  const calls = [];
  const db = { onlineClassBatch: { findMany: async args => { assert.deepEqual(args.where, { isActive: true }); return [{ name: "New Directory Batch" }]; } }, facultyOnlineClass: {
    findMany: async args => { calls.push(args); return args.select ? [{ batchName: "Batch A" }, { batchName: "Legacy unused", batches: [{ nameSnapshot: "Batch B" }, { nameSnapshot: "Batch A" }] }] : []; },
    count: async args => { calls.push(args); return 37; },
  } };
  const result = await listOnlineClasses({ facultyId: "faculty-own", historyFilters: true, page: 2, search: "JAVA", date: "2026-10-12", batch: "Batch A" }, db);
  assert.equal(result.total, 37);
  assert.deepEqual(result.batches, ["Batch A", "Batch B", "New Directory Batch"]);
  assert.equal(calls[0].skip, 20);
  assert.deepEqual(calls[0].orderBy, [{ startsAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(calls[0].where, calls[1].where);
  assert.equal(calls[0].where.AND[0].facultyId, "faculty-own");
  assert.equal(calls[0].where.AND[1].AND[0].OR[0].batches.some.nameSnapshot.equals, "Batch A");
  assert.deepEqual(calls[2].where, { facultyId: "faculty-own", deletedAt: null });
});

test("directory options survive zero history/results while historical deleted batch names stay filterable", async () => {
  let history = [];
  const db = { onlineClassBatch: { findMany: async () => [{ name: "Active A" }, { name: "Active B" }] }, facultyOnlineClass: {
    findMany: async args => args.select ? history : [], count: async () => 0,
  } };
  let result = await listOnlineClasses({ facultyId: "own", historyFilters: true, search: "no results", batch: "Active A" }, db);
  assert.deepEqual(result.batches, ["Active A", "Active B"]); assert.equal(result.total, 0);
  history = [{ batchName: "Legacy Deleted" }, { batchName: "unused", batches: [{ nameSnapshot: "Active A" }, { nameSnapshot: "Historical Deleted" }] }];
  result = await listOnlineClasses({ facultyId: "own", historyFilters: true, date: "2026-10-12" }, db);
  assert.deepEqual(result.batches, ["Active A", "Active B", "Historical Deleted", "Legacy Deleted"]);
  db.onlineClassBatch.findMany = async () => { throw new Error("Directory unavailable"); };
  await assert.rejects(listOnlineClasses({ facultyId: "own", historyFilters: true }, db), /Directory unavailable/);
});

test("unfiltered existing records endpoints retain their original query shape", async () => {
  const db = { facultyOnlineClass: { findMany: async args => {
    assert.deepEqual(args.where, { AND: [{ facultyId: "own", incentiveTypeId: "online", deletedAt: null }] });
    return [];
  } } };
  const result = await listOnlineClasses({ facultyId: "own", incentiveTypeId: "online" }, db);
  assert.equal(result.hasMore, false);
  assert.equal(result.total, undefined);
});

test("ended class filters apply complete evidence before pagination for Faculty and Admin", async () => {
  let sql = "";
  let rawValues = [];
  const queries = [];
  const db = {
    $queryRaw: async (parts, ...values) => {
      sql = parts.join("?");
      rawValues = values;
      return [
        { id: "eligible", eligible: true },
        { id: "unverified", eligible: false },
        { id: "one-hour", eligible: false },
      ];
    },
    facultyOnlineClass: {
      findMany: async args => { if (!args.select) queries.push(args); return []; },
      count: async () => 3,
    },
    onlineClassBatch: { findMany: async () => [] },
  };

  await listOnlineClasses({
    facultyId: "faculty-own",
    incentiveTypeId: "online-type",
    historyFilters: true,
    recordStatuses: ["COMPLETED", "INCOMPLETE"],
    page: 2,
  }, db);
  const facultyWhere = queries[0].where;
  await listOnlineClasses({
    incentiveTypeId: "online-type",
    historyFilters: true,
    recordStatuses: ["COMPLETED", "INCOMPLETE"],
  }, db);
  const adminWhere = queries[1].where;

  assert.match(sql, /actualEndAt" > c\."actualStartAt" \+ INTERVAL '3600 seconds'/);
  assert.match(sql, /actualStartAt" >= c\."createdAt"/);
  assert.match(sql, /verificationStatus" = 'VERIFIED'/);
  assert.match(sql, /attendanceEvidence/);
  assert.match(sql, /FacultyExtraIncentiveEntry/);
  assert.match(sql, /cancelledAt" IS NULL/);
  assert.equal(rawValues[0], null, "Admin classification is not faculty-limited");
  assert.deepEqual(facultyWhere.AND[0], { deletedAt: null, facultyId: "faculty-own", incentiveTypeId: "online-type" });
  assert.deepEqual(facultyWhere.AND[2].OR, [
    { id: { in: ["eligible"] } },
    { id: { in: ["unverified", "one-hour"] } },
  ]);
  assert.equal(queries[0].skip, 20, "classification IDs are applied before page slicing");
  assert.deepEqual(adminWhere.AND[2], facultyWhere.AND[2], "both portals apply the same eligibility set");
  assert.equal(JSON.stringify(facultyWhere).includes("verificationStatus\":null"), false);
});

test("DTO exposes verified completion only for the fully linked strict-duration evidence", () => {
  const start = new Date("2026-10-11T12:00:00Z");
  const entry = { id: "entry", facultyId: "faculty", incentiveTypeId: "type", quantityChange: 1, status: "PAID", rateSnapshot: 200, amountSnapshot: 200, paymentRecordId: "payment" };
  const row = {
    id: "class", facultyId: "faculty", incentiveTypeId: "type", incentiveEntryId: "entry", incentiveEntry: entry,
    createdAt: new Date(+start - 60000),
    faculty: { fullName: "Teacher", facultyId: "FAC1" }, batches: [], batchName: "Batch A", topic: "Topic",
    status: "COMPLETED", verificationStatus: "VERIFIED", actualStartAt: start,
    actualEndAt: new Date(+start + 3601000), conferenceName: "conferenceRecords/one",
    attendanceCompleteAt: new Date(), teacherGoogleUserId: "users/teacher",
    attendanceEvidence: { summary: { complete: true, teacherVerified: true, verifiedNonTeacher: 1 } },
  };
  assert.equal(onlineClassDto(row).verifiedCompletion, true, "a paid incentive does not undo the verified class lifecycle");
  assert.equal(onlineClassDto({ ...row, actualEndAt: new Date(+start + 3600000) }).verifiedCompletion, false);
  assert.equal(onlineClassDto({ ...row, createdAt: new Date(+start + 1) }).verifiedCompletion, false);
  assert.equal(onlineClassDto({ ...row, incentiveEntry: null }).verifiedCompletion, false);
  assert.equal(onlineClassDto({ ...row, verificationStatus: "TEACHER_IDENTITY_REVIEW" }).verifiedCompletion, false);
});

test("online-class pending entries require linked eligible evidence; non-online sets do not", () => {
  const start = new Date("2026-10-11T12:00:00Z");
  const entry = {
    id: "entry-one", facultyId: "faculty-one", incentiveTypeId: "online-type", quantityChange: 1,
    status: "PENDING", incentiveType: { name: "Online Doubt Class" },
    onlineClass: {
      id: "class-one", facultyId: "faculty-one", incentiveTypeId: "online-type", incentiveEntryId: "entry-one",
      createdAt: new Date(+start - 60000),
      status: "COMPLETED", verificationStatus: "VERIFIED", conferenceName: "conferenceRecords/one",
      actualStartAt: start, actualEndAt: new Date(+start + 3601000), attendanceCompleteAt: new Date(),
      teacherGoogleUserId: "users/teacher", attendanceEvidence: { summary: { complete: true, teacherVerified: true, verifiedNonTeacher: 1 } },
    },
  };
  assert.equal(isOnlineClassIncentiveEntryEligible(entry), true);
  assert.equal(isOnlineClassIncentiveEntryEligible({ ...entry, onlineClass: { ...entry.onlineClass, actualEndAt: new Date(+start + 3600000) } }), false);
  assert.equal(isOnlineClassIncentiveEntryEligible({ ...entry, onlineClass: { ...entry.onlineClass, verificationStatus: "TEACHER_IDENTITY_REVIEW" } }), false);
  assert.equal(isOnlineClassIncentiveEntryEligible({ ...entry, onlineClass: { ...entry.onlineClass, attendanceEvidence: { summary: { complete: false, teacherVerified: true, verifiedNonTeacher: 1 } } } }), false);
  assert.equal(isOnlineClassIncentiveEntryEligible({ ...entry, onlineClass: { ...entry.onlineClass, attendanceEvidence: { summary: { complete: true, teacherVerified: true, verifiedNonTeacher: 0 } } } }), false);
  assert.equal(isOnlineClassIncentiveEntryEligible({ ...entry, onlineClass: { ...entry.onlineClass, incentiveEntryId: "other-entry" } }), false);
  assert.equal(isOnlineClassIncentiveEntryEligible({ ...entry, onlineClass: null }), false, "unlinked online classes cannot enter payout");
  assert.equal(isOnlineClassIncentiveEntryEligible({ ...entry, onlineClass: { ...entry.onlineClass, actualEndAt: new Date(+start + 3600000) } }), false, "early ended classes cannot enter payout");
  assert.equal(isOnlineClassIncentiveEntryEligible({ ...entry, onlineClass: { ...entry.onlineClass, status: "LIVE" } }), false, "live classes cannot enter payout");
  assert.equal(isOnlineClassIncentiveEntryEligible({
    id: "copy-set", facultyId: "faculty-one", incentiveTypeId: "copy-type", quantityChange: 4,
    status: "PENDING", incentiveType: { name: "Question Paper" }, onlineClass: null,
  }), true, "ordinary pending incentive sets remain payable without an online-class relation");
  assert.equal(isOnlineClassIncentiveEntryEligible({ ...entry, status: "PAID" }), false, "paid records are excluded");
  assert.equal(isOnlineClassIncentiveEntryEligible({ ...entry, status: "PROCESSING" }), false, "processing records cannot be paid twice");
});
