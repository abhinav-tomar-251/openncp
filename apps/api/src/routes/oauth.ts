import type { FastifyInstance } from "fastify";
import { prisma, type Prisma } from "@opennpc/db";
import { encryptSecret } from "@opennpc/core";
import {
  loadOAuthAppFromEnv,
  generatePkce,
  generateState,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  createConnection,
  probeOrg,
  PROD_LOGIN_URL,
  SANDBOX_LOGIN_URL,
  type CapabilityReport,
} from "@opennpc/salesforce";

const WEB_APP_URL = process.env.WEB_APP_URL ?? "http://localhost:3000";

type Role = "source" | "target";

export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  /** Begin the OAuth Authorization Code + PKCE flow; redirects to Salesforce. */
  app.get("/oauth/start", async (req, reply) => {
    const { projectId, role, sandbox } = req.query as {
      projectId?: string;
      role?: string;
      sandbox?: string;
    };
    if (!projectId || (role !== "source" && role !== "target")) {
      return reply.code(400).send({ error: "projectId and role=source|target are required" });
    }
    const project = await prisma.migrationProject.findUnique({ where: { id: projectId } });
    if (!project) return reply.code(404).send({ error: "project not found" });

    const loginUrl = sandbox === "true" ? SANDBOX_LOGIN_URL : process.env.SF_LOGIN_URL ?? PROD_LOGIN_URL;
    const oauthApp = loadOAuthAppFromEnv(loginUrl);
    const { verifier, challenge } = generatePkce();
    const state = generateState();

    await prisma.oAuthState.create({
      data: { state, projectId, role, codeVerifier: verifier, loginUrl },
    });

    return reply.redirect(buildAuthorizeUrl(oauthApp, { state, codeChallenge: challenge }));
  });

  /** OAuth redirect handler: exchange code, probe org, store encrypted tokens. */
  app.get("/oauth/callback", async (req, reply) => {
    const { code, state, error, error_description } = req.query as Record<string, string | undefined>;

    if (error) {
      return reply.redirect(`${WEB_APP_URL}/?oauth_error=${encodeURIComponent(error_description ?? error)}`);
    }
    if (!code || !state) return reply.code(400).send({ error: "missing code or state" });

    const saved = await prisma.oAuthState.findUnique({ where: { state } });
    if (!saved) return reply.code(400).send({ error: "invalid or expired state" });
    await prisma.oAuthState.delete({ where: { state } });

    const oauthApp = loadOAuthAppFromEnv(saved.loginUrl);
    const token = await exchangeCodeForToken(oauthApp, code, saved.codeVerifier);

    const conn = createConnection({ instanceUrl: token.instance_url, accessToken: token.access_token });
    let capability: CapabilityReport | { error: string };
    try {
      capability = await probeOrg(conn, saved.role as Role, token.id);
    } catch (e) {
      capability = { error: (e as Error).message };
    }
    const orgId = "orgId" in capability ? capability.orgId : null;

    const tokenMeta = {
      issued_at: token.issued_at,
      scope: token.scope,
      identityUrl: token.id,
      loginUrl: saved.loginUrl,
      capability,
    } as Prisma.InputJsonValue;

    await prisma.orgConnection.upsert({
      where: { projectId_role: { projectId: saved.projectId, role: saved.role } },
      create: {
        projectId: saved.projectId,
        role: saved.role,
        instanceUrl: token.instance_url,
        orgId,
        apiVersion: conn.version,
        accessTokenEnc: encryptSecret(token.access_token),
        refreshTokenEnc: token.refresh_token ? encryptSecret(token.refresh_token) : null,
        tokenMeta,
      },
      update: {
        instanceUrl: token.instance_url,
        orgId,
        apiVersion: conn.version,
        accessTokenEnc: encryptSecret(token.access_token),
        refreshTokenEnc: token.refresh_token ? encryptSecret(token.refresh_token) : undefined,
        tokenMeta,
      },
    });

    return reply.redirect(`${WEB_APP_URL}/projects/${saved.projectId}?connected=${saved.role}`);
  });
}
