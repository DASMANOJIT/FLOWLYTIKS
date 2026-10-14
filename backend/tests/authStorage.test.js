import test from "node:test";
import assert from "node:assert/strict";
import { storeAuthSession, getAuthToken, getAuthRole, clearAuthSessionForUnauthorizedResponse } from "../../frontend/lib/authStorage.js";

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), key: index => [...values.keys()][index], get length() { return values.size; } };
};
globalThis.window = { sessionStorage: storage(), localStorage: storage() };

test("permission, server, network and stale authentication responses preserve the current login", () => {
  storeAuthSession({ token: "current-admin-test-token", role: "admin", name: "Admin" });
  for (const status of [403, 400, 500, 503, 0]) {
    assert.equal(clearAuthSessionForUnauthorizedResponse(status, getAuthToken(), "admin"), false);
    assert.equal(getAuthRole(), "admin");
  }
  assert.equal(clearAuthSessionForUnauthorizedResponse(401, "previous-faculty-test-token"), false);
  assert.equal(clearAuthSessionForUnauthorizedResponse(401, getAuthToken(), "faculty"), false);
  assert.equal(getAuthToken(), "current-admin-test-token");
});

test("a genuine 401 for the current login clears only its auth keys", () => {
  window.sessionStorage.setItem("unrelated", "preserved");
  assert.equal(clearAuthSessionForUnauthorizedResponse(401, getAuthToken(), "admin"), true);
  assert.equal(getAuthToken(), "");
  assert.equal(window.sessionStorage.getItem("unrelated"), "preserved");
});
