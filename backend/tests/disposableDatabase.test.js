import test from "node:test";
import assert from "node:assert/strict";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("database test setup refuses application, remote and unacknowledged targets", () => {
  for (const env of [
    {},
    { FLOWLYTIKS_DISPOSABLE_DATABASE: "true", TEST_DATABASE_URL: "postgresql://localhost/application" },
    { FLOWLYTIKS_DISPOSABLE_DATABASE: "true", TEST_DATABASE_URL: "postgresql://remote.invalid/flowlytiks_test_local" },
    { FLOWLYTIKS_DISPOSABLE_DATABASE: "true", TEST_DATABASE_URL: "postgresql://localhost/flowlytiks_test_local", DATABASE_URL: "postgresql://localhost/flowlytiks_test_local" },
  ]) assert.throws(() => requireDisposableDatabase(env));
  const env = { FLOWLYTIKS_DISPOSABLE_DATABASE: "true", TEST_DATABASE_URL: "postgresql://localhost/flowlytiks_test_guard" };
  assert.equal(requireDisposableDatabase(env), env.TEST_DATABASE_URL);
  assert.equal(requireDisposableDatabase(env), env.TEST_DATABASE_URL);
});
