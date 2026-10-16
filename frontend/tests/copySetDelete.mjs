import assert from "node:assert/strict";
import { cp, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

// Presentation checks use synthetic API responses. Real API/database races are tested separately in backend.
const frontend = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), "flowlytiks-copy-delete-"));
console.log("Isolated browser artifacts", directory);
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
const types = [{ id: "copies", name: "Question Paper", rate: 75 }, { id: "online", name: "ONLINE DOUBT CLASS", rate: 200, onlineClassWorkflow: true }];
let entries = Array.from({ length: 21 }, (_, i) => ({ id: `set-${i}`, incentiveTypeId: "copies", name: "Question Paper", quantityChange: 1, rate: 75, amount: 75, note: `Set ${i} remark`, status: i ? "PENDING" : "PAID", editable: Boolean(i), createdAt: "2026-10-16T07:00:00Z", updatedAt: "2026-10-16T07:00:00Z" }));
let server, browser, page, deletes = 0, failDelete = false, releaseDelete;
const stop = async child => { if (!child || child.exitCode !== null) return; const done = new Promise(resolve => child.once("exit", resolve)); child.kill("SIGTERM"); await done; };
try {
  await cp(frontend, directory, { recursive: true, filter: file => !path.basename(file).startsWith(".env") && !path.basename(file).startsWith(".next") && !["node_modules", "tsconfig.tsbuildinfo", ".git"].includes(path.basename(file)) });
  await symlink(path.join(frontend, "node_modules"), path.join(directory, "node_modules"), "dir");
  const env = { ...process.env, BACKEND_URL: "http://127.0.0.1:1", NEXT_PUBLIC_API_URL: "", NEXT_PUBLIC_BACKEND_URL: "", FLOWLYTIKS_BROWSER_ISOLATED: "true", NODE_OPTIONS: `--import ${path.join(directory, "tests/isolateServerNetwork.mjs")}` };
  assert.equal(spawnSync(process.execPath, [path.join(frontend, "node_modules/next/dist/bin/next"), "build", "--webpack"], { cwd: directory, env, stdio: "inherit" }).status, 0);
  const reservation = net.createServer(); await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve)); const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  server = spawn(process.execPath, [path.join(frontend, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => { server.stdout.on("data", data => { if (data.toString().includes("Ready")) resolve(); }); server.once("exit", () => reject(new Error("Isolated frontend exited"))); });
  browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH });
  page = await browser.newPage();
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (url.pathname === "/api/auth/heartbeat") return json({ success: true });
    if (url.pathname === "/api/faculty-extra-incentives/my") {
      const pending = entries.filter(entry => entry.status === "PENDING");
      return json({ types, entries, payments: [], pendingSummary: [{ incentiveTypeId: "copies", name: "Question Paper", quantity: pending.length, amount: pending.length * 75, rate: 75 }] });
    }
    if (url.pathname.endsWith("/online-classes")) return json({ records: [], hasMore: false });
    if (route.request().method() === "DELETE") {
      deletes++;
      assert.equal(route.request().postDataJSON().expectedUpdatedAt, "2026-10-16T07:00:00Z");
      if (failDelete) return json({ message: "This set is reserved by a payment." }, 409);
      await new Promise(resolve => { releaseDelete = resolve; });
      entries = entries.filter(entry => entry.id !== url.pathname.split("/").at(-1));
      return json({ success: true });
    }
    if (url.pathname.endsWith("/sets")) {
      const current = Number(url.searchParams.get("page") || 1);
      return json({ entries: entries.slice((current - 1) * 20, current * 20), totalPages: Math.max(1, Math.ceil(entries.length / 20)) });
    }
    throw new Error(`Unexpected fixture API: ${url.pathname}`);
  });
  await page.addInitScript(() => { sessionStorage.setItem("token", "eyJhbGciOiJub25lIn0.eyJpZCI6ImZpeHR1cmUiLCJyb2xlIjoiZmFjdWx0eSJ9.fixture"); sessionStorage.setItem("authRole", "faculty"); });
  await page.goto(`http://127.0.0.1:${port}/faculty/extra-incentives`);
  await page.getByRole("button", { name: "Edit Question Paper", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await modal.getByText("Page 2 of 2", { exact: true }).waitFor();
  page.once("dialog", dialog => dialog.dismiss());
  await modal.getByRole("button", { name: "Delete Set", exact: true }).click();
  assert.equal(deletes, 0, "Cancelled confirmation must not issue a request");
  failDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await modal.getByRole("button", { name: "Delete Set", exact: true }).click();
  await modal.getByRole("alert").filter({ hasText: "reserved" }).waitFor();
  assert.equal(await modal.getByRole("button", { name: "Delete Set", exact: true }).count(), 1);
  failDelete = false;
  page.once("dialog", dialog => dialog.accept());
  await modal.getByRole("button", { name: "Delete Set", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("dialog button")].some(button => button.textContent.includes("Delete Set") && button.disabled));
  assert.equal(deletes, 2);
  assert.equal(typeof releaseDelete, "function"); releaseDelete();
  await modal.getByText("Page 1 of 1", { exact: true }).waitFor();
  await modal.getByRole("status").filter({ hasText: "Set deleted." }).waitFor();
  assert.equal(await modal.getByRole("button", { name: "Delete Set", exact: true }).count(), 19);
  assert.ok((await modal.locator("dl").textContent()).includes("1,425"));
  for (const width of [320, 341, 390, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await modal.locator("[class*=setActions]").evaluateAll(groups => groups.every(group => [...group.children].every(button => {
      const rect = button.getBoundingClientRect(), card = group.closest("li").getBoundingClientRect();
      return rect.left >= card.left && rect.right <= card.right && rect.height >= 44;
    }))));
    await page.screenshot({ path: path.join(directory, `copy-delete-${width}.png`) });
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "View Records ONLINE DOUBT CLASS", exact: true }).click();
  await modal.getByText("No online class records found.").waitFor();
  assert.equal(await modal.getByRole("button", { name: "Delete Set", exact: true }).count(), 0);
  console.log("PASS: confirmation, failure feedback, busy controls, last-page deletion, refreshed totals, mobile actions and unchanged online records card");
} catch (error) {
  if (page) { await page.screenshot({ path: path.join(directory, "failure.png") }); await writeFile(path.join(directory, "failure.html"), await page.content()); }
  throw error;
} finally { if (releaseDelete) releaseDelete(); await browser?.close(); await stop(server); }
