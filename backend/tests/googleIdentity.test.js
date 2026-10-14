import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { verifyGoogleIdentity } from "../services/facultyGoogleService.js";

test("Google library validates signature, issuer, audience, expiry and bound nonce", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const verifier = new OAuth2Client("test-client");
  verifier.getFederatedSignonCertsAsync = async () => ({ certs: { fixture: publicKey.export({ type: "spki", format: "pem" }) } });
  const payload = { iss: "https://accounts.google.com", aud: "test-client", sub: "123456789", nonce: "controlled-nonce", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
  const nonceHash = createHash("sha256").update(payload.nonce).digest("hex");
  const sign = (changes = {}, key = privateKey) => jwt.sign({ ...payload, ...changes }, key, { algorithm: "RS256", keyid: "fixture" });
  assert.equal(await verifyGoogleIdentity(sign(), nonceHash, "test-client", verifier), payload.sub);
  const wrongKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  for (const token of [sign({ iss: "https://wrong.example" }), sign({ aud: "wrong-client" }), sign({ exp: payload.iat - 1 }), sign({ nonce: "another-nonce" }), sign({}, wrongKey)]) {
    await assert.rejects(verifyGoogleIdentity(token, nonceHash, "test-client", verifier), { status: 409 });
  }
  await assert.rejects(verifyGoogleIdentity(sign(), null, "test-client", verifier), { status: 409 });
});
