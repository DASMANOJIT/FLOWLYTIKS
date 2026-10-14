import { cp, mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const source = fileURLToPath(new URL("../", import.meta.url));
const destination = await mkdtemp(path.join(tmpdir(), "flowlytiks-phase2-build-"));
await cp(source, destination, { recursive: true, filter: file => {
  const name = path.basename(file);
  return !name.startsWith(".env") && !name.startsWith(".next") &&
    !["node_modules", "tsconfig.tsbuildinfo", ".git"].includes(name);
} });
await symlink(path.join(source, "node_modules"), path.join(destination, "node_modules"), "dir");
const env = { ...process.env, FLOWLYTIKS_BROWSER_ISOLATED: "true", BACKEND_URL: "http://127.0.0.1:59999", NEXT_PUBLIC_API_URL: "", NEXT_PUBLIC_BACKEND_URL: "", CRM_API_KEY: "isolated", NODE_OPTIONS: `--import ${path.join(destination, "tests/isolateServerNetwork.mjs")}` };
console.log("Isolated build workspace:", destination);
const result = spawnSync(process.execPath, [path.join(source, "node_modules/next/dist/bin/next"), "build", "--webpack"], { cwd: destination, env, stdio: "inherit" });
await rm(destination, { recursive: true, force: true });
if (result.error) throw result.error;
process.exitCode = result.status || 0;
