import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { requireDisposableDatabase } from "./disposableDatabase.js";

const target = requireDisposableDatabase();
const cwd = fileURLToPath(new URL("../", import.meta.url));
const env = {
  ...process.env, DATABASE_URL: target,
  RUN_MEET_POSTGRES_TESTS: "true", RUN_COPY_SET_POSTGRES_TESTS: "true",
  RUN_ONLINE_DELETE_POSTGRES_TESTS: "true", RUN_ADMIN_ONLINE_POSTGRES_TESTS: "true",
  RUN_PHASE2_POSTGRES_TESTS: "true",
};
function run(file, args, childEnv = env) {
  const result = spawnSync(file, args, { cwd, env: childEnv, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
// Existing migration history is replayed only after the disposable-target guard.
run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"]);
const testEnv = { ...env, DATABASE_URL: "" };
run(process.execPath, ["tests/seedDisposableDatabase.js"], testEnv);
const files = readdirSync(new URL("./", import.meta.url)).filter(name => name.endsWith(".postgres.test.js")).map(name => `tests/${name}`);
run(process.execPath, ["--import", "./tests/setupDisposableDatabase.js", "--test", "--test-concurrency=1", ...files], testEnv);
