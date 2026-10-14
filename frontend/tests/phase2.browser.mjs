import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const moduleUrl = process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright";
const { chromium } = await import(moduleUrl);
const base = process.env.TEST_FRONTEND_URL || "http://127.0.0.1:3311";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Browser tests must target an isolated local frontend");
const jwt = role => `test.${Buffer.from(JSON.stringify({ id: 1, role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test`;
const profile = { id: "phase2-staff", name: "Test Staff", email: "staff@example.invalid", role: "STAFF", isActive: true, verifiedAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" };

async function setup(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  let role = "admin";
  const calls = [];
  await context.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    calls.push({ path, method: req.method() });
    let payload = { success: true }, status = 200;
    if (path.endsWith("/login")) payload = { success: true, token: jwt(role), role, name: "Test User" };
    else if (path === "/api/auth/heartbeat" || path === "/api/auth/logout") payload = { success: true };
    else if (path === "/api/staff/me") payload = { success: true, staff: profile };
    else if (path === "/api/staff/students") payload = { success: true, month: "October", academicYear: 2026, summary: { totalStudents: 0, paidStudents: 0, unpaidStudents: 0 }, students: [], classes: [], pagination: { page: 1, pages: 0, total: 0 } };
    else if (path === "/api/staff/activity") payload = { success: true, activity: [] };
    else if (path === "/api/staff/password-reset/send-code") payload = { success: true, cooldown: 15, message: "Test code sent by mock provider." };
    else if (path === "/api/staff/password-reset/verify") {
      assert.equal(JSON.parse(req.postData()).code, "012345");
      payload = { success: true, resetToken: "a".repeat(64) };
    } else if (path === "/api/staff/password-reset/save") payload = { success: true, message: "Password reset successful." };
    else if (path === "/api/faculty-extra-incentives/my") payload = { types: [{ id: "online-type", name: "ONLINE DOUBT CLASS", rate: 200, onlineClassWorkflow: true }], pending: [], records: [], payments: [] };
    else if (path === "/api/faculty-extra-incentives/my/online-classes") payload = { records: [], hasMore: false, teacherName: "Test Faculty", total: 0, batches: ["Long batch name for responsive multi-select testing"] };
    else if (path === "/api/faculty-extra-incentives/online-class-directory") payload = { batches: [{ id: "batch-one", name: "Long batch name for responsive multi-select testing", isActive: true }] };
    else if (path === "/api/faculty/google/status") payload = { status: "NOT_CONNECTED" };
    else if (path === "/api/students/me") payload = { id: 1, name: "Test Student", class: "8", school: "Test School", monthlyFee: 600, joinDate: "2026-03-01T00:00:00Z" };
    else if (path === "/api/payments/my") payload = [];
    else { status = 503; payload = { success: false, message: "This API is outside the browser fixture; no application backend was contacted." }; }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, async route => {
    if (new URL(route.request().url()).pathname.startsWith("/api/")) return route.fallback();
    await route.abort();
  });
  return { context, page, calls, setRole: value => { role = value; } };
}

async function noOverflow(page) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(dimensions.document <= dimensions.viewport + 1, `Horizontal overflow: ${dimensions.document} > ${dimensions.viewport}`);
}

test("four role selections, student-only signup, recovery transitions and login routing at mobile/desktop widths", async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || chromium.executablePath() });
  await mkdir("/tmp/flowlytiks-phase2-screenshots", { recursive: true });
  try {
    for (const width of [320, 341, 390, 1440]) {
      const { context, page, setRole, calls } = await setup(browser, width);
      try {
        for (const [role, label, destination] of [["admin", "Admin", "/admin"], ["student", "Students", "/student"], ["faculty", "Faculty", "/faculty/dashboard"], ["staff", "Staff", "/staff/dashboard"]]) {
          setRole(role); await page.goto(`${base}/login`);
          await page.getByRole("button", { name: label, exact: true }).click();
          assert.equal(await page.getByRole("button", { name: "Sign Up", exact: true }).count(), role === "student" ? 1 : 0);
          await noOverflow(page);
          const form = page.locator("form:visible");
          if (role === "staff") {
            await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
            await page.getByLabel("Staff reset email").fill("staff@example.invalid");
            await page.getByRole("button", { name: "Send verification code", exact: true }).click();
            await page.getByLabel("Staff verification code").fill("012345");
            await page.getByRole("button", { name: "Verify code", exact: true }).click();
            await page.getByLabel("New Staff password", { exact: true }).fill("Test-New-Password2!");
            await page.getByLabel("Confirm Staff password").fill("Test-New-Password2!");
            await page.getByRole("button", { name: "Save password", exact: true }).click();
            await page.getByLabel("Staff email").waitFor();
          }
          await form.locator("input").first().fill(`${role}@example.invalid`);
          await form.locator('input[type="password"]').fill("Test-Password1!");
          await form.getByRole("button", { name: "Sign In", exact: true }).click();
          await page.waitForURL(`**${destination}`);
          assert.equal(await page.evaluate(() => sessionStorage.getItem("authRole")), role);
          assert.ok(calls.some(call => call.path === (role === "faculty" ? "/api/faculty-auth/login" : role === "staff" ? "/api/staff/login" : "/api/auth/login")));
          await page.reload();
          assert.equal(await page.evaluate(() => sessionStorage.getItem("authRole")), role);
          await page.screenshot({ path: `/tmp/flowlytiks-phase2-screenshots/${role}-${width}.png`, animations: "disabled" });
        }
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});

test("faculty batch dropdown and Google modal keyboard/focus/mobile bounds", async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || chromium.executablePath() });
  try {
    for (const width of [320, 341, 390, 1440]) {
      const { context, page } = await setup(browser, width);
      try {
        await context.addInitScript(token => { sessionStorage.setItem("token", token); sessionStorage.setItem("authRole", "faculty"); }, jwt("faculty"));
        await page.goto(`${base}/faculty/online-classes`);
        const trigger = page.getByRole("button", { name: /Select batches/i });
        await trigger.waitFor();
        assert.equal(await page.getByRole("dialog", { name: "Choose batches" }).isVisible(), false);
        await trigger.click();
        await page.getByRole("checkbox").first().check();
        await page.getByRole("button", { name: "Done", exact: true }).click();
        await noOverflow(page);
        const google = page.getByRole("button", { name: "Google Account", exact: true });
        await google.click();
        const dialog = page.getByRole("dialog"); await dialog.waitFor();
        await page.getByRole("button", { name: "Connect Google", exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
        await page.keyboard.press("Tab");
        assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true);
        await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
        assert.equal(await google.evaluate(node => node === document.activeElement), true);
        await noOverflow(page);
        await page.screenshot({ path: `/tmp/flowlytiks-phase2-screenshots/online-classes-${width}.png`, animations: "disabled" });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});

test("temporary student dashboard API failure preserves the valid session", async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || chromium.executablePath() });
  const { context, page } = await setup(browser, 390);
  try {
    await context.addInitScript(token => { sessionStorage.setItem("token", token); sessionStorage.setItem("authRole", "student"); }, jwt("student"));
    await context.route("**/api/students/me", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Temporary database failure" }) }));
    await page.goto(`${base}/student`);
    await page.waitForFunction(() => document.querySelector('[role="alert"]') || location.pathname === "/login");
    assert.equal(new URL(page.url()).pathname, "/student");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("authRole")), "student");
  } finally { await context.close(); await browser.close(); }
});
