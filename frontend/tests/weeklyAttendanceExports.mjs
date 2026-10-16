import assert from "node:assert/strict";
import { cp, mkdtemp, symlink, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";

// No application connection or credentials: real read/export controllers use
// synthetic in-memory query results. This is not a database/authentication test.
process.env.DATABASE_URL = "postgresql://unused@127.0.0.1:1/flowlytiks_test_unused";
process.env.NODE_ENV = "production";
const frontend = fileURLToPath(new URL("../", import.meta.url));
const root = path.dirname(frontend.replace(/\/$/, ""));
const requireBackend = createRequire(path.join(root, "backend/package.json"));
const express = requireBackend("express");
const XLSX = (await import(pathToFileURL(path.join(frontend, "node_modules/xlsx/xlsx.mjs")).href));
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
const { default: db } = await import(pathToFileURL(path.join(root, "backend/prisma/client.js")).href);
const { attendanceWeek } = await import(pathToFileURL(path.join(root, "backend/services/dailyAttendanceService.js")).href);
const { groupAttendanceFaculty } = await import(pathToFileURL(path.join(frontend, "lib/attendancePresentation.js")).href);
const { getWorkLedgerEntries, exportWorkLedgerReport, exportWorkLedgerCsv } = await import(pathToFileURL(path.join(root, "backend/controllers/workledgercontrollers.js")).href);
const directory = await mkdtemp(path.join(tmpdir(), "flowlytiks-weekly-export-"));
console.log("Isolated export artifacts", directory);
const { start, end } = attendanceWeek();
const day = i => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); return d; };
const iso = d => d.toISOString().slice(0, 10);
const roster = Array.from({ length: 65 }, (_, i) => ({ id: `faculty-${i}`, facultyId: `TEST${String(i).padStart(3, "0")}`, fullName: i === 0 ? "Manojit Test" : i === 1 ? "Long Faculty Name With Several Words For Wrapping In Reports" : i === 2 ? "  =HYPERLINK(\"https://example.invalid\")" : `Faculty ${i}` }));
const records = [];
const add = (i, offset, shift, amount) => records.push({ id: `entry-${records.length}`, facultyId: roster[i].id, faculty: roster[i], date: day(offset), shift, amount, remarks: records.length === 0 ? "\t=UNTRUSTED()" : "Fixture", createdBy: "Fixture", updatedBy: "Fixture", updatedByRole: "ADMIN", createdAt: new Date(), updatedAt: new Date() });
for (let i = 0; i < 64; i++) { add(i, 0, "MORNING", i === 0 ? 375 : 200); add(i, 0, "EVENING", 200); }
add(0, 1, "MORNING", 400); add(0, 1, "EVENING", 400); add(1, 1, "MORNING", 400);
add(3, 2, "DAILY", 333); add(4, 3, "AFTERNOON", 123.45);
add(0, 7, "MORNING", 9999);
const selected = records.filter(row => row.date <= end), total = selected.reduce((sum, row) => sum + row.amount, 0);
assert.equal(groupAttendanceFaculty(selected.filter(row => +row.date === +start)).length, 64);
db.workLedgerEntry.findMany = async ({ where }) => records.filter(row => row.date >= where.date.gte && row.date <= where.date.lte);
db.faculty.findMany = async () => roster;
for (const model of [db.payrollCycle, db.facultyPayout, db.weeklyFacultyPaymentRecord]) model.findFirst = async () => null;
const app = express();
app.use((req, res, next) => { req.userRole = req.headers.authorization ? "admin" : "student"; next(); });
app.get("/api/auth/heartbeat", (req, res) => res.json({ success: true }));
app.get("/api/faculty", (req, res) => res.json({ faculty: roster }));
app.get("/api/faculty-weekly-payments/status", (req, res) => res.json({ totalAmount: total, totalEntries: selected.length, facultyCount: 64, status: "UNPAID", facultyRows: [] }));
app.get("/api/work-ledger", getWorkLedgerEntries);
app.get("/api/work-ledger/admin/attendance/eligible", (req, res) => res.json({ faculty: roster.slice(-1) }));
app.get("/api/work-ledger/export.json", exportWorkLedgerReport);
app.get("/api/work-ledger/export.csv", exportWorkLedgerCsv);
let server, site, browser, page;
const stop = async child => { if (!child || child.exitCode !== null) return; const done = new Promise(resolve => child.once("exit", resolve)); child.kill("SIGTERM"); await done; };
try {
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/work-ledger/export.json?week=${iso(start)}`)).status, 403);
  const report = await (await fetch(`${base}/api/work-ledger/export.json?week=${iso(start)}&facultyId=wrong&shift=EVENING&limit=1`, { headers: { Authorization: "fixture" } })).json();
  assert.equal(report.matrix.rows.length, 65); assert.equal(report.matrix.totals.weeklyAmount, total);
  assert.equal(report.entries.length, selected.length);
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report));
  await cp(frontend, directory, { recursive: true, filter: file => !path.basename(file).startsWith(".env") && !path.basename(file).startsWith(".next") && !["node_modules", "tsconfig.tsbuildinfo", ".git"].includes(path.basename(file)) });
  await symlink(path.join(frontend, "node_modules"), path.join(directory, "node_modules"), "dir");
  const env = { ...process.env, BACKEND_URL: base, NEXT_PUBLIC_API_URL: "", NEXT_PUBLIC_BACKEND_URL: "", FLOWLYTIKS_BROWSER_ISOLATED: "true", NODE_OPTIONS: `--import ${path.join(directory, "tests/isolateServerNetwork.mjs")}` };
  assert.equal(spawnSync(process.execPath, [path.join(frontend, "node_modules/next/dist/bin/next"), "build", "--webpack"], { cwd: directory, env, stdio: "inherit" }).status, 0);
  const reservation = net.createServer(); await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve)); const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  site = spawn(process.execPath, [path.join(frontend, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => { site.stdout.on("data", data => { if (data.toString().includes("Ready")) resolve(); }); site.once("exit", () => reject(new Error("Isolated frontend exited"))); });
  browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH });
  page = await browser.newPage({ acceptDownloads: true });
  await page.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.addInitScript(() => { sessionStorage.setItem("token", "eyJhbGciOiJub25lIn0.eyJpZCI6MSwicm9sZSI6ImFkbWluIn0.fixture"); sessionStorage.setItem("authRole", "admin"); });
  await page.goto(`http://127.0.0.1:${port}/admin/faculty/work-ledger`);
  const summary = page.getByRole("button", { name: /^View all attendance/ }).filter({ hasText: "Manojit +63" });
  await summary.waitFor();
  assert.ok((await page.locator(".work-ledger-calendar-grid tfoot").textContent()).includes("27,431.45"));
  await summary.click();
  const modal = page.getByRole("dialog"); await modal.waitFor();
  assert.equal(await modal.locator("tbody tr").count(), 128);
  assert.deepEqual(await modal.locator(".work-ledger-detail-section h3").allTextContents(), ["MORNING SHIFT", "EVENING SHIFT"]);
  assert.equal(await modal.locator("input, select").count(), 0, "Status and amounts are read-only");
  assert.equal(await modal.getByRole("button", { name: /^Delete .* attendance$/ }).count(), 128);
  await modal.locator(".weekly-attendance-details__body").evaluate(element => { element.scrollTop = element.scrollHeight; });
  assert.ok(await modal.getByRole("button", { name: "Add People", exact: true }).isVisible());
  assert.ok(await modal.getByRole("button", { name: "Close", exact: true }).isVisible());
  await modal.getByRole("button", { name: "Add People", exact: true }).click();
  await modal.getByLabel("Faculty Name", { exact: true }).selectOption("faculty-64");
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.keyboard.press("Escape"); await modal.waitFor({ state: "hidden" }); assert.ok(await summary.evaluate(button => document.activeElement === button));
  await page.keyboard.press("Enter"); await modal.waitFor(); await page.keyboard.press("Escape");
  for (const width of [320, 341, 390, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.locator(".weekly-attendance-summary").evaluateAll(buttons => buttons.every(button => { const cell = button.closest("td").getBoundingClientRect(), rect = button.getBoundingClientRect(); return rect.right <= cell.right + 1 && rect.left >= cell.left - 1; })));
    await page.locator(".work-ledger-calendar-grid").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(directory, `attendance-${width}.png`) });
    if ([320, 1280].includes(width)) {
      await summary.click(); await modal.waitFor();
      assert.ok(await modal.evaluate(dialog => dialog.getBoundingClientRect().width <= innerWidth));
      assert.ok(await modal.locator(".weekly-attendance-details__body").evaluate(element => element.scrollHeight > element.clientHeight));
      assert.ok(await modal.locator(".weekly-attendance-details").evaluate(card => [...card.querySelectorAll("h2, .faculty-modal-header button, .faculty-modal-footer button")].every(element => {
        const rect = element.getBoundingClientRect(), bounds = card.getBoundingClientRect();
        return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
      })), "Header and close controls must not clip inside the mobile card");
      await modal.locator(".weekly-attendance-details__body").evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: path.join(directory, `attendance-modal-${width}.png`) });
      await page.keyboard.press("Escape"); await modal.waitFor({ state: "hidden" });
    }
  }
  for (const format of ["CSV", "XLSX", "PDF"]) {
    const waiting = page.waitForEvent("download"); await page.getByRole("button", { name: format, exact: true }).click(); const file = await (await waiting).path();
    await cp(file, path.join(directory, `attendance.${format.toLowerCase()}`));
  }
  const workbook = XLSX.read(await readFile(path.join(directory, "attendance.xlsx")), { type: "buffer", cellStyles: true });
  assert.deepEqual(workbook.SheetNames, ["Weekly Attendance", "Work Ledger", "Faculty Totals", "Totals"]);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Weekly Attendance"], { header: 1 });
  assert.equal(rows[0][0], report.matrix.title); assert.ok(rows.find(row => row[0] === "TEST002")[1].startsWith("'"));
  assert.equal(rows.length, 71); assert.equal(rows.at(-1)[17], total);
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets["Work Ledger"]).length, selected.length);
  for (const sheet of Object.values(workbook.Sheets)) for (const [address, cell] of Object.entries(sheet)) if (!address.startsWith("!")) assert.equal(cell.f, undefined);
  const validation = spawnSync(process.env.TEST_PDF_PYTHON, ["-c", `import sys,json,csv,zipfile,xml.etree.ElementTree as E
from pypdf import PdfReader
p=sys.argv[1];r=PdfReader(p+'/attendance.pdf');texts=[page.extract_text() for page in r.pages]
assert all(float(page.mediabox.width)>float(page.mediabox.height) for page in r.pages)
assert 'Weekly Faculty Attendance' in texts[0]
assert len(texts)>=2
assert all('Morning' in t and 'Evening' in t for t in texts)
assert 'TEST064' in ''.join(texts)
normalized=' '.join(' '.join(texts).split())
assert 'Detailed Work Ledger' not in normalized
assert 'Legacy / Unallocated INR' not in normalized
assert 'Historical unallocated attendance: INR 456.45' in normalized
assert '27431.45' in normalized
with open(p+'/attendance.csv',newline='',encoding='utf8') as f: rows=list(csv.reader(f))
assert rows[3][2].startswith('Friday') and rows[3][15].startswith('Thursday')
assert len(rows[3])==18
assert any(row and row[0].startswith("'  =") for row in rows)==False
assert any(len(row)>1 and row[1].startswith("'  =") for row in rows)
with zipfile.ZipFile(p+'/attendance.xlsx') as z:
 ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
 styles=E.fromstring(z.read('xl/styles.xml'));sheet=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
 cells={c.attrib['r']:c for c in sheet.findall('.//s:c',ns)};formats=styles.find('s:cellXfs',ns);fills=styles.find('s:fills',ns)
 colours=[fills[int(formats[int(cells[a].attrib['s'])].attrib['fillId'])].find('.//s:fgColor',ns).attrib['rgb'] for a in ['C5','D5']]
 assert colours==['FFDBEAFE','FFCFFAFE'],colours
print(json.dumps({'pdfPages':len(r.pages),'matrixPages':len(texts),'shiftColours':colours,'csvColumns':len(rows[3])}))`, directory], { encoding: "utf8" });
  assert.equal(validation.status, 0, validation.stderr); console.log(validation.stdout);
  console.log("PASS: complete matrix, detailed exports, colours, totals, escaping, modal and responsive cells");
} catch (error) {
  if (page) { await page.screenshot({ path: path.join(directory, "failure.png") }); await writeFile(path.join(directory, "failure.html"), await page.content()); }
  throw error;
} finally {
  await browser?.close(); await stop(site); if (server) await new Promise(resolve => server.close(resolve)); await db.$disconnect();
}
