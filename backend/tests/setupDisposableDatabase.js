import { requireDisposableDatabase } from "./disposableDatabase.js";
requireDisposableDatabase();
process.env.NODE_ENV = "production";
process.env.JWT_SECRET = "isolated-test-signing-key-not-for-deployment";
process.env.RESEND_API_KEY = "isolated-test-provider";
process.env.EMAIL_FROM = "test@example.invalid";
process.env.NOTIFICATION_EMAIL_ENABLED = "false";
process.env.ENABLE_BACKGROUND_JOBS = "false";
process.env.ENABLE_MEET_POLLING = "false";
// A test must explicitly mock a provider; accidental network calls fail closed.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const target = new URL(String(input));
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) throw new Error("External access disabled in database tests");
  return originalFetch(input, options);
};
