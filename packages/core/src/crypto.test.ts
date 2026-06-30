import { test, before } from "node:test";
import assert from "node:assert/strict";

before(() => {
  // 32-byte base64 key for the test.
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

test("encrypt/decrypt round-trips", async () => {
  const { encryptSecret, decryptSecret } = await import("./crypto.js");
  const secret = "5Aep861...refresh-token...xyz";
  const enc = encryptSecret(secret);
  assert.ok(Buffer.isBuffer(enc));
  assert.notEqual(enc.toString("utf8"), secret); // actually encrypted
  assert.equal(decryptSecret(enc), secret);
});

test("ciphertext differs each time (random IV)", async () => {
  const { encryptSecret, decryptSecret } = await import("./crypto.js");
  const a = encryptSecret("same");
  const b = encryptSecret("same");
  assert.notEqual(a.toString("hex"), b.toString("hex"));
  assert.equal(decryptSecret(a), "same");
  assert.equal(decryptSecret(b), "same");
});

test("tampered ciphertext fails authentication", async () => {
  const { encryptSecret, decryptSecret } = await import("./crypto.js");
  const enc = encryptSecret("secret");
  const last = enc.length - 1;
  enc[last] = (enc[last] ?? 0) ^ 0xff; // flip a byte
  assert.throws(() => decryptSecret(enc));
});
