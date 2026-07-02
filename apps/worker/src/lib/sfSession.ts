import { prisma } from "@opennpc/db";
import { decryptSecret, encryptSecret } from "@opennpc/core";
import {
  loadOAuthAppFromEnv,
  refreshAccessToken,
  createConnection,
  type Connection,
  type OrgRole,
} from "@opennpc/salesforce";

/**
 * Build a live jsforce Connection for a project's org by refreshing the stored
 * (encrypted) refresh token. The freshly-issued access token is re-encrypted and
 * persisted. Source connections are marked read-only.
 */
export async function getLiveConnection(
  projectId: string,
  role: OrgRole,
): Promise<{ conn: Connection; instanceUrl: string }> {
  const oc = await prisma.orgConnection.findUnique({
    where: { projectId_role: { projectId, role } },
  });
  if (!oc?.refreshTokenEnc) {
    throw new Error(`No ${role} connection (or missing refresh token) for project ${projectId}`);
  }

  const meta = (oc.tokenMeta ?? {}) as { loginUrl?: string };
  const app = loadOAuthAppFromEnv(meta.loginUrl);
  const refreshToken = decryptSecret(Buffer.from(oc.refreshTokenEnc));
  const token = await refreshAccessToken(app, refreshToken);

  await prisma.orgConnection.update({
    where: { projectId_role: { projectId, role } },
    data: {
      accessTokenEnc: encryptSecret(token.access_token),
      instanceUrl: token.instance_url,
    },
  });

  return {
    conn: createConnection({
      instanceUrl: token.instance_url,
      accessToken: token.access_token,
      readOnly: role === "source",
    }),
    instanceUrl: token.instance_url,
  };
}
