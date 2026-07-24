import type { FastifyInstance } from "fastify";
import { prisma, type Prisma } from "@opennpc/db";
import { encryptSecret, decryptSecret } from "@opennpc/core";
import {
  loadOAuthAppFromEnv,
  refreshAccessToken,
  createConnection,
  probeOrg,
} from "@opennpc/salesforce";
import { requireAuth } from "../auth.js";
import { getOwnedProject } from "../lib/ownership.js";

type Role = "source" | "target";

export async function connectionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  /** Re-run the capability probe using the stored refresh token. */
  app.post("/projects/:id/connections/:role/probe", async (req, reply) => {
    const { id, role } = req.params as { id: string; role: Role };
    if (role !== "source" && role !== "target") {
      return reply.code(400).send({ error: "role must be source or target" });
    }
    if (!(await getOwnedProject(req.userId!, id))) {
      return reply.code(404).send({ error: "project not found" });
    }

    const conn = await prisma.orgConnection.findUnique({
      where: { projectId_role: { projectId: id, role } },
    });
    if (!conn || !conn.refreshTokenEnc) {
      return reply.code(404).send({ error: "connection not found or missing refresh token" });
    }

    const meta = (conn.tokenMeta ?? {}) as { loginUrl?: string };
    const oauthApp = loadOAuthAppFromEnv(role, meta.loginUrl);
    const refreshToken = decryptSecret(Buffer.from(conn.refreshTokenEnc));
    const token = await refreshAccessToken(oauthApp, refreshToken);

    const sf = createConnection({ instanceUrl: token.instance_url, accessToken: token.access_token });
    const capability = await probeOrg(sf, role, conn.orgId ? undefined : token.id);

    await prisma.orgConnection.update({
      where: { projectId_role: { projectId: id, role } },
      data: {
        accessTokenEnc: encryptSecret(token.access_token),
        // Some orgs rotate the refresh token on every refresh-grant exchange;
        // if we don't persist a rotated one here, the next refresh (from this
        // route or getLiveConnection) fails with invalid_grant.
        refreshTokenEnc: token.refresh_token ? encryptSecret(token.refresh_token) : undefined,
        instanceUrl: token.instance_url,
        tokenMeta: {
          ...meta,
          capability,
          refreshedAt: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return { capability };
  });
}
