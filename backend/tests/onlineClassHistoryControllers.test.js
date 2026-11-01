import test from "node:test";
import assert from "node:assert/strict";

const recordQueries = [];
const db = {
  $queryRaw: async () => [
    { id: "eligible-completed", eligible: true },
    { id: "ended-incomplete", eligible: false },
  ],
  facultyOnlineClass: {
    findMany: async args => {
      if (!args.select) recordQueries.push(args);
      return [];
    },
    count: async () => 2,
  },
  onlineClassBatch: { findMany: async () => [] },
  faculty: {
    findMany: async () => [],
    findUnique: async ({ where }) => ({ id: where.id, fullName: "Test Faculty" }),
  },
};

globalThis.__flowlytiksPrisma = db;
const { getAdminOnlineClasses, getMyOnlineClasses } = await import("../controllers/facultyonlineclasscontrollers.js");

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("Admin and Faculty history endpoints use shared completed/incomplete evidence classification", async () => {
  const adminCompleted = response();
  await getAdminOnlineClasses({ query: { status: "COMPLETED", page: "1" } }, adminCompleted);
  const adminIncomplete = response();
  await getAdminOnlineClasses({ query: { status: "INCOMPLETE", page: "1" } }, adminIncomplete);
  const faculty = response();
  await getMyOnlineClasses({
    query: { statuses: "COMPLETED,INCOMPLETE", page: "1" },
    user: { id: "faculty-one" },
  }, faculty);

  assert.equal(adminCompleted.statusCode, 200);
  assert.equal(adminIncomplete.statusCode, 200);
  assert.equal(faculty.statusCode, 200);
  const completed = recordQueries[0].where.AND.at(-1).OR[0].id.in;
  const incomplete = recordQueries[1].where.AND.at(-1).OR[0].id.in;
  const facultyStatuses = recordQueries[2].where.AND.at(-1).OR;
  assert.deepEqual(completed, ["eligible-completed"]);
  assert.deepEqual(incomplete, ["ended-incomplete"]);
  assert.deepEqual(facultyStatuses[0].id.in, completed);
  assert.deepEqual(facultyStatuses[1].id.in, incomplete);
  assert.equal(recordQueries[0].where.AND[0].facultyId, undefined, "Admin sees the all-faculty scope");
  assert.equal(recordQueries[2].where.AND[0].facultyId, "faculty-one", "Faculty remains ownership-scoped");
});
