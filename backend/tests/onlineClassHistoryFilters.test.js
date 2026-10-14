import test from "node:test";
import assert from "node:assert/strict";
import { listOnlineClasses, onlineClassHistoryWhere } from "../services/facultyOnlineClassService.js";

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
  assert.equal(calls[0].where.facultyId, "faculty-own");
  assert.equal(calls[0].where.AND[0].OR[0].batches.some.nameSnapshot.equals, "Batch A");
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
    assert.deepEqual(args.where, { facultyId: "own", incentiveTypeId: "online", deletedAt: null });
    return [];
  } } };
  const result = await listOnlineClasses({ facultyId: "own", incentiveTypeId: "online" }, db);
  assert.equal(result.hasMore, false);
  assert.equal(result.total, undefined);
});
