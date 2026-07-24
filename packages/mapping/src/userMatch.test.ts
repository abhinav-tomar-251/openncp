import { test } from "node:test";
import assert from "node:assert/strict";
import { matchUsersByEmailOrUsername } from "./userMatch.js";

test("matches by email, case-insensitively", () => {
  const source = [{ id: "005S1", username: "s1@npsp.org", email: "Jane@Example.com" }];
  const target = [{ id: "005T1", username: "jane.doe", email: "jane@example.com" }];
  const matches = matchUsersByEmailOrUsername(source, target);
  assert.equal(matches.get("005S1"), "005T1");
});

test("falls back to username when email doesn't match", () => {
  const source = [{ id: "005S1", username: "Jane.Doe", email: "jane@old-domain.org" }];
  const target = [{ id: "005T1", username: "jane.doe", email: "jane@new-domain.org" }];
  const matches = matchUsersByEmailOrUsername(source, target);
  assert.equal(matches.get("005S1"), "005T1");
});

test("no match when neither email nor username align", () => {
  const source = [{ id: "005S1", username: "s1", email: "s1@a.com" }];
  const target = [{ id: "005T1", username: "t1", email: "t1@b.com" }];
  const matches = matchUsersByEmailOrUsername(source, target);
  assert.equal(matches.has("005S1"), false);
});

test("prefers email match over a coincidental username collision elsewhere", () => {
  const source = [{ id: "005S1", username: "shared", email: "correct@a.com" }];
  const target = [
    { id: "005T1", username: "shared", email: "wrong@b.com" },
    { id: "005T2", username: "other", email: "correct@a.com" },
  ];
  const matches = matchUsersByEmailOrUsername(source, target);
  assert.equal(matches.get("005S1"), "005T2");
});
