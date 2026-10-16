import test from "node:test";
import assert from "node:assert/strict";
import { buildWeeklyAttendanceMatrix } from "../services/weeklyAttendanceMatrix.js";

test("weekly matrix retains zero-attendance roster and historical faculty, with actual shift and legacy totals", () => {
  const start = new Date("2026-10-16"), end = new Date("2026-10-22");
  const faculty = { id: "a", facultyId: "FAC_A", fullName: "A Teacher" };
  const entries = [["MORNING", 375, "2026-10-16"], ["EVENING", 200, "2026-10-16"], ["DAILY", 333, "2026-10-17"], ["AFTERNOON", 123.45, "2026-10-18"]].map(([shift, amount, date]) => ({ facultyId: "a", faculty, shift, amount, date }));
  entries.push({ facultyId: "old", faculty: { id: "old", facultyId: "OLD", fullName: "Historical Teacher" }, shift: "MORNING", amount: 19, date: "2026-10-22" });
  const report = buildWeeklyAttendanceMatrix(entries, [faculty, { id: "b", fullName: "Zero Attendance" }], start, end);
  assert.deepEqual(report.days.map(day => day.date), ["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"]);
  assert.equal(report.rows.length, 3);
  const row = report.rows.find(row => row.facultyId === "a");
  assert.equal(row.days[0].MORNING.present, true); assert.equal(row.days[0].MORNING.amount, 375);
  assert.equal(row.days[1].MORNING.present, false); assert.equal(row.legacyAmount, 456.45);
  assert.equal(row.weeklyAmount, 1031.45);
  assert.equal(report.totals.weeklyAmount, 1050.45);
  assert.equal(report.totals.days[6].MORNING, 19);
  assert.equal(report.rows.find(row => row.facultyId === "b").weeklyAmount, 0);
  assert.equal(report.totals.legacyAmount + report.totals.days.reduce((sum, day) => sum + day.MORNING + day.EVENING, 0), report.totals.weeklyAmount);
});
