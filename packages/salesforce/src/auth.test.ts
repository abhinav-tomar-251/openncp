import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generatePkce,
  generateState,
  buildAuthorizeUrl,
  parseIdentityUrl,
  DEFAULT_SCOPES,
} from "./auth.js";

const app = {
  loginUrl: "https://login.salesforce.com",
  clientId: "3MVG9abc",
  clientSecret: "secret",
  redirectUri: "http://localhost:3001/oauth/callback",
};

test("PKCE produces a url-safe verifier and S256 challenge", () => {
  const { verifier, challenge } = generatePkce();
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(verifier, challenge);
});

test("state is non-empty and url-safe", () => {
  assert.match(generateState(), /^[A-Za-z0-9_-]+$/);
});

test("authorize URL has all required OAuth + PKCE params", () => {
  const url = new URL(
    buildAuthorizeUrl(app, { state: "xyz", codeChallenge: "chal" }),
  );
  assert.equal(url.origin + url.pathname, "https://login.salesforce.com/services/oauth2/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), app.clientId);
  assert.equal(url.searchParams.get("redirect_uri"), app.redirectUri);
  assert.equal(url.searchParams.get("scope"), DEFAULT_SCOPES.join(" "));
  assert.equal(url.searchParams.get("state"), "xyz");
  assert.equal(url.searchParams.get("code_challenge"), "chal");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

test("parseIdentityUrl extracts orgId and userId", () => {
  const parsed = parseIdentityUrl(
    "https://login.salesforce.com/id/00D5g000004abcEAA/0055g000004xyzAAA",
  );
  assert.deepEqual(parsed, { orgId: "00D5g000004abcEAA", userId: "0055g000004xyzAAA" });
  assert.equal(parseIdentityUrl("garbage"), null);
});
