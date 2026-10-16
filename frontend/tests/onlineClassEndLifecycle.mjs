import assert from "node:assert/strict";
import { cp, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

// Synthetic browser API fixtures only; real routes/worker/database coverage is in meetLifecycle.postgres.test.js.
const source = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), "flowlytiks-online-end-"));
console.log("Isolated online-class browser artifacts", directory);
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
const scheduled = { id: "scheduled", teacherName: "Fixture Teacher", facultyCode: "FAC_TEST", incentiveTypeId: "online", batchIds: ["batch"], batchNames: ["Fixture Batch"], batchName: "Fixture Batch", className: "", topic: "Scheduled fixture", startsAt: "2026-10-16T05:30:00Z", endsAt: null, meetUrl: "https://meet.google.com/abc-defg-hij", status: "SCHEDULED", verificationStatus: "PENDING", canEdit: true, canCancel: true, canDelete: true, trackingEnabled: true, updatedAt: "2026-10-16T05:00:00Z", announcement: "Fixture announcement", incentive: null };
const ended = { ...scheduled, id: "ended", topic: "Ended fixture", status: "COMPLETED", actualStartAt: "2026-10-16T05:30:00Z", actualEndAt: "2026-10-16T06:00:00Z", actualDurationSeconds: 1800, verificationStatus: "ATTENDANCE_PENDING", verificationPending: true, verificationError: "Meeting ended. Final attendance verification is pending.", canEdit: false, canCancel: false, canDelete: false };
let server, browser, page;
const submissions = [];
try {
  await cp(source, directory, { recursive: true, filter: file => !path.basename(file).startsWith(".env") && !path.basename(file).startsWith(".next") && !["node_modules", "tsconfig.tsbuildinfo", ".git"].includes(path.basename(file)) });
  await symlink(path.join(source, "node_modules"), path.join(directory, "node_modules"), "dir");
  const env = { ...process.env, BACKEND_URL: "http://127.0.0.1:1", NEXT_PUBLIC_API_URL: "", NEXT_PUBLIC_BACKEND_URL: "", FLOWLYTIKS_BROWSER_ISOLATED: "true", NODE_OPTIONS: `--import ${path.join(directory, "tests/isolateServerNetwork.mjs")}` };
  assert.equal(spawnSync(process.execPath, [path.join(source, "node_modules/next/dist/bin/next"), "build", "--webpack"], { cwd: directory, env, stdio: "inherit" }).status, 0);
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  server = spawn(process.execPath, [path.join(source, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => { server.stdout.on("data", data => { if (data.toString().includes("Ready")) resolve(); }); server.once("exit", () => reject(new Error("Isolated frontend exited"))); });
  browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH });
  for (const role of ["faculty", "admin"]) {
    const context = await browser.newContext(); page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const json = body => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (url.pathname === "/api/auth/heartbeat") return json({ success: true });
      if (url.pathname === "/api/faculty/google/status") return json({ status: "NOT_CONNECTED", configured: true });
      if (url.pathname.endsWith("/online-class-directory")) return json({ batches: [{ id: "batch", name: "Fixture Batch", isActive: true }] });
      if (url.pathname === "/api/faculty-extra-incentives/my") return json({ types: [{ id: "online", name: "ONLINE DOUBT CLASS", rate: 200 }] });
      if (["POST", "PATCH"].includes(route.request().method())) {
        const body = route.request().postDataJSON(); assert.equal(Object.hasOwn(body, "endTime"), false);
        assert.ok(body.batchIds.includes("batch")); assert.ok(body.date && body.startTime && body.topic && body.meetUrl);
        submissions.push({ role, body }); return json({ success: true, record: { ...scheduled, topic: body.topic } });
      }
      if (url.pathname.endsWith("/online-classes")) return json({ records: [scheduled, ended], hasMore: false, total: 2, batches: ["Fixture Batch"], teacherName: "Fixture Teacher", faculties: [{ id: "faculty", facultyId: "FAC_TEST", fullName: "Fixture Teacher" }] });
      throw new Error(`Unexpected fixture API: ${url.pathname}`);
    });
    await context.addInitScript(role => { sessionStorage.setItem("token", `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ id: role === "admin" ? 1 : "faculty", role }))}.fixture`); sessionStorage.setItem("authRole", role); }, role);
    await page.goto(`http://127.0.0.1:${port}/${role === "admin" ? "admin" : "faculty"}/online-classes`);
    await page.getByText("Scheduled fixture", { exact: true }).first().waitFor();
    const completed = page.locator("article").filter({ hasText: "Ended fixture" });
    assert.ok((await completed.textContent()).includes("Completed")); assert.ok((await completed.textContent()).includes("30m 0s"));
    assert.ok((await completed.textContent()).includes("ATTENDANCE PENDING"));
    if (role === "faculty") {
      await page.getByRole("button", { name: /Batches.*Select batches/ }).click();
      await page.getByRole("checkbox", { name: "Fixture Batch", exact: true }).check();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await page.getByLabel("Topic / Title").fill("Created without end");
      await page.getByLabel("Class Date (IST)", { exact: true }).fill("2026-10-17");
      await page.getByLabel("Start Time hour", { exact: true }).selectOption("11");
      await page.getByLabel("Start Time minute", { exact: true }).selectOption("05");
      await page.getByLabel("Google Meet Link").fill(scheduled.meetUrl);
      await page.getByRole("button", { name: "Save Class & Generate Message", exact: true }).click();
      await page.getByText("Class scheduled. No incentive has been added.", { exact: true }).waitFor();
    }
    await page.getByRole("button", { name: "Edit Class", exact: true }).click();
    const form = role === "admin" ? page.getByRole("dialog").locator("form") : page.locator("form").first();
    assert.equal(await page.getByLabel(/End Time (hour|minute)/).count(), 0);
    for (const width of [320, 341, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await form.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await form.locator("input,select,textarea,button").evaluateAll(items => items.filter(item => item.getClientRects().length).every(item => { const rect = item.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; })));
      await page.screenshot({ path: path.join(directory, `${role}-form-${width}.png`) });
    }
    await form.getByRole("button", { name: "Save Changes", exact: true }).click();
    await page.getByText(role === "faculty" ? "Class scheduled. No incentive has been added." : "Class updated.", { exact: true }).waitFor();
    assert.equal(errors.length, 0, errors.join("\n"));
    await context.close();
  }
  assert.equal(submissions.length, 3);
  console.log("PASS: Faculty creation/edit and Admin edit omit end time; completed/pending badges, actual duration, mobile and desktop forms");
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: path.join(directory, "failure.png") }); await writeFile(path.join(directory, "failure.html"), await page.content()); }
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { const done = new Promise(resolve => server.once("exit", resolve)); server.kill("SIGTERM"); await done; }
}
