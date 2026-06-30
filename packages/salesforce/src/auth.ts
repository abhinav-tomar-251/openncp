import { createHash, randomBytes } from "node:crypto";

/**
 * OAuth 2.0 Authorization Code + PKCE for Salesforce External Client Apps (ECA).
 * Connected Apps are deprecated; the OAuth flow is identical. See docs/07-salesforce-integration.md.
 *
 * Token exchange/refresh are done with direct calls to the Salesforce token
 * endpoint (full control over PKCE), not via jsforce's OAuth helper.
 */

export interface OAuthAppConfig {
  /** https://login.salesforce.com (prod) or https://test.salesforce.com (sandbox). */
  loginUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  instance_url: string;
  /** Identity URL: https://login.salesforce.com/id/{orgId}/{userId} */
  id: string;
  token_type: string;
  issued_at: string;
  scope?: string;
  signature?: string;
}

export const DEFAULT_SCOPES = ["api", "refresh_token", "offline_access"];
export const PROD_LOGIN_URL = "https://login.salesforce.com";
export const SANDBOX_LOGIN_URL = "https://test.salesforce.com";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE verifier + S256 challenge. */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** Opaque CSRF/state token. */
export function generateState(): string {
  return base64url(randomBytes(24));
}

export function buildAuthorizeUrl(
  app: OAuthAppConfig,
  params: { state: string; codeChallenge: string; scopes?: string[] },
): string {
  const url = new URL("/services/oauth2/authorize", app.loginUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", app.clientId);
  url.searchParams.set("redirect_uri", app.redirectUri);
  url.searchParams.set("scope", (params.scopes ?? DEFAULT_SCOPES).join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCodeForToken(
  app: OAuthAppConfig,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  return tokenRequest(app.loginUrl, {
    grant_type: "authorization_code",
    code,
    client_id: app.clientId,
    client_secret: app.clientSecret,
    redirect_uri: app.redirectUri,
    code_verifier: codeVerifier,
  });
}

export async function refreshAccessToken(
  app: OAuthAppConfig,
  refreshToken: string,
): Promise<TokenResponse> {
  return tokenRequest(app.loginUrl, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: app.clientId,
    client_secret: app.clientSecret,
  });
}

async function tokenRequest(loginUrl: string, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(new URL("/services/oauth2/token", loginUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const json = (await res.json()) as Partial<TokenResponse> & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok || json.error) {
    throw new Error(
      `Salesforce token error: ${json.error ?? res.status} ${json.error_description ?? ""}`.trim(),
    );
  }
  return json as TokenResponse;
}

/** Parse orgId/userId out of an identity URL without an API call. */
export function parseIdentityUrl(identityUrl: string): { orgId: string; userId: string } | null {
  const m = /\/id\/([0-9A-Za-z]{15,18})\/([0-9A-Za-z]{15,18})/.exec(identityUrl);
  return m ? { orgId: m[1]!, userId: m[2]! } : null;
}

/** Build an OAuthAppConfig from environment variables. */
export function loadOAuthAppFromEnv(loginUrlOverride?: string): OAuthAppConfig {
  const clientId = process.env.SF_ECA_CLIENT_ID;
  const clientSecret = process.env.SF_ECA_CLIENT_SECRET;
  const redirectUri = process.env.SF_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Set SF_ECA_CLIENT_ID, SF_ECA_CLIENT_SECRET, and SF_OAUTH_REDIRECT_URI (External Client App).",
    );
  }
  return {
    loginUrl: loginUrlOverride ?? process.env.SF_LOGIN_URL ?? PROD_LOGIN_URL,
    clientId,
    clientSecret,
    redirectUri,
  };
}
