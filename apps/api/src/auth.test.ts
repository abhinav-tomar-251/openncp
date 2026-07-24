import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./auth.js";

test("hashPassword produces a verifiable, non-plaintext hash", async () => {
  const hashed = await hashPassword("correct horse battery staple");
  assert.notEqual(hashed, "correct horse battery staple");
  assert.equal(await verifyPassword(hashed, "correct horse battery staple"), true);
  assert.equal(await verifyPassword(hashed, "wrong password"), false);
});

test("hashing the same password twice yields different hashes (salted)", async () => {
  const a = await hashPassword("same-password");
  const b = await hashPassword("same-password");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(a, "same-password"), true);
  assert.equal(await verifyPassword(b, "same-password"), true);
});
