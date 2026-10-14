import assert from "node:assert/strict";
import { cp, mkdtemp, symlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import net from "node:net";
import { performance } from "node:perf_hooks";

export async function measureBrowser(fixture, output) {
  assert.equal(process.env.FLOWLYTIKS_DISPOSABLE_DATABASE, "true");
  const source = fileURLToPath(new URL("../", import.meta.url));
  const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
  const destination = await mkdtemp(path.join(tmpdir(), "flowlytiks-phase4-browser-"));
  let frontend, browser;
  const results = { pages: [], exports: [] };
  try {
    await cp(source, destination, { recursive: true, filter: file => { const name = path.basename(file); return !name.startsWith(".env") && !name.startsWith(".next") && !["node_modules", "tsconfig.tsbuildinfo", ".git"].includes(name); } });
    await symlink(path.join(source, "node_modules"), path.join(destination, "node_modules"), "dir");
    const env = { ...process.env, FLOWLYTIKS_BROWSER_ISOLATED: "true", BACKEND_URL: fixture.base, NEXT_PUBLIC_API_URL: "", NEXT_PUBLIC_BACKEND_URL: "", CRM_API_KEY: "isolated", NODE_OPTIONS: `--import ${path.join(destination, "tests/isolateServerNetwork.mjs")}` };
    // Asynchronous build: it must not pause the API load driver's event loop.
    const buildStart = performance.now();
    const build = spawn(process.execPath, [path.join(source, "node_modules/next/dist/bin/next"), "build", "--webpack"], { cwd: destination, env, stdio: "inherit" });
    assert.equal(await new Promise(resolve => build.once("exit", resolve)), 0, "Isolated production build");
    results.buildSeconds = (performance.now() - buildStart) / 1000;
    const probe = net.createServer().listen(0, "127.0.0.1"); await new Promise(resolve => probe.once("listening", resolve));
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    frontend = spawn(process.execPath, [path.join(source, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: destination, env, stdio: ["ignore", "ignore", "pipe"] });
    frontend.stderr.on("data", data => process.stderr.write(data));
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/login`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 200)); }
    browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH });
    for (const [role, routes] of [["admin", ["/admin", "/students", "/admin/online-classes", "/admin/faculty/work-ledger"]], ["student", ["/student"]], ["faculty", ["/faculty/dashboard", "/faculty/attendance", "/faculty/online-classes"]], ["staff", ["/staff/dashboard", "/staff/students", "/staff/follow-ups"]]]) {
      const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
      await context.route(/^https?:\/\//, route => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      // Already-authenticated sessions are issued by the real fixture backend, not fake API responses.
      await context.addInitScript(({ token, role, name }) => { sessionStorage.setItem("token", token); sessionStorage.setItem("authRole", role); sessionStorage.setItem("studentName", name); }, { token: fixture.tokens[role], role, name: fixture.users[role].name });
      const page = await context.newPage();
      for (const route of routes) {
        for (const run of ["cold-page", "warm-page"]) {
          const errors = [], requests = [];
          const onResponse = response => { if (response.url().includes("/api/")) requests.push({ path: new URL(response.url()).pathname, status: response.status() }); };
          const onError = error => errors.push(error.message);
          page.on("response", onResponse); page.on("pageerror", onError);
          const start = performance.now(); await page.goto(base + route, { waitUntil: "domcontentloaded" });
          // Dashboard polling means networkidle is not an application-ready signal.
          await page.waitForTimeout(3500);
          const timing = await page.evaluate(() => ({ navigation: performance.getEntriesByType("navigation").map(n => ({ domContentLoadedMs: n.domContentLoadedEventEnd, loadMs: n.loadEventEnd }))[0], resources: performance.getEntriesByType("resource").map(r => ({ path: new URL(r.name).pathname, startMs: r.startTime, durationMs: r.duration, bytes: r.transferSize, decodedBytes: r.decodedBodySize })), overflow: document.documentElement.scrollWidth > innerWidth }));
          page.off("response", onResponse); page.off("pageerror", onError);
          results.pages.push({ role, route, run, settleMs: performance.now() - start, requests, errors, ...timing });
          await writeFile(path.join(output, "browser-partial.json"), JSON.stringify(results, null, 2));
          assert.ok(!page.url().includes("/login"), `Session preserved: ${route}`);
          assert.equal(errors.length, 0, `Browser errors: ${route}`);
          assert.ok(requests.length > 0 && requests.every(request => request.status === 200), `Successful real API responses: ${route}`);
          console.log(`Phase4 browser ${role} ${route} ${run}: ${requests.length} API responses`);
        }
        if (route === "/admin/faculty/work-ledger") {
          for (const format of ["XLSX", "PDF"]) {
            const start = performance.now(), download = page.waitForEvent("download");
            await page.getByRole("button", { name: format, exact: true }).click();
            const file = path.join(output, `phase4-ledger.${format.toLowerCase()}`); await (await download).saveAs(file);
            results.exports.push({ format, ms: performance.now() - start, bytes: (await stat(file)).size });
          }
        }
      }
      await context.close();
    }
    return results;
  } catch (error) {
    results.error = error.message;
    await writeFile(path.join(output, "browser-partial.json"), JSON.stringify(results, null, 2));
    throw error;
  } finally {
    await browser?.close();
    if (frontend && frontend.exitCode === null) { const exited = new Promise(resolve => frontend.once("exit", resolve)); frontend.kill("SIGTERM"); await exited; }
    await rm(destination, { recursive: true, force: true });
  }
}
