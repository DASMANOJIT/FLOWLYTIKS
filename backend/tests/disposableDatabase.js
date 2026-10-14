import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
const configured = new WeakSet();

// Never fall back to the application's .env when a database test is enabled.
export function requireDisposableDatabase(env = process.env) {
  if (configured.has(env)) return env.TEST_DATABASE_URL;
  assert.equal(env.FLOWLYTIKS_DISPOSABLE_DATABASE, "true", "Explicit disposable database acknowledgement required");
  assert.ok(env.TEST_DATABASE_URL, "TEST_DATABASE_URL required");
  const target = new URL(env.TEST_DATABASE_URL);
  assert.ok(["postgresql:", "postgres:"].includes(target.protocol), "PostgreSQL target required");
  assert.match(target.pathname, /^\/flowlytiks_test_[a-z0-9_]+$/, "Only explicitly named disposable test databases are allowed");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname), "Test setup is restricted to local isolated PostgreSQL");
  assert.ok(!target.searchParams.has("schema") || target.searchParams.get("schema") === "public", "Test setup must use its own database, not an application schema");
  if (env.DATABASE_URL) assert.notEqual(new URL(env.DATABASE_URL).pathname, target.pathname, "Application database cannot be used as the test target");
  const envFile = new URL("../.env", import.meta.url);
  const applicationUrl = existsSync(envFile) ? parse(readFileSync(envFile)).DATABASE_URL : null;
  if (applicationUrl) {
    const application = new URL(applicationUrl);
    assert.ok(application.hostname !== target.hostname || application.port !== target.port || application.pathname !== target.pathname, "Configured application database cannot be a test target");
  }
  env.DATABASE_URL = env.TEST_DATABASE_URL;
  configured.add(env);
  return env.TEST_DATABASE_URL;
}
