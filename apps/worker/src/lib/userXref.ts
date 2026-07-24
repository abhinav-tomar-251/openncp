import { prisma, type Prisma } from "@opennpc/db";
import { matchUsersByEmailOrUsername, type DirectoryUser } from "@opennpc/mapping";
import type { Connection } from "@opennpc/salesforce";
import { getLiveConnection } from "./sfSession.js";

export interface UserMatchStats {
  skipped?: string;
  sourceCount?: number;
  targetCount?: number;
  matched?: number;
}

/**
 * Build the source User -> target User id_xref by matching on email/username.
 * Users are never created in the target org (that requires license/provisioning
 * decisions outside this platform's scope) — this only links existing accounts so
 * OwnerId can be remapped on migrated records. See docs/05-data-model-mapping.md §8.
 *
 * Idempotent: clears prior User id_xref rows for the project before rewriting.
 * Never throws — a missing source extract or an unconnected target org just means
 * OwnerId remapping is skipped for this run (records still load, owned by whichever
 * default the target org applies, typically the integration user).
 */
export async function matchAndXrefUsers(projectId: string): Promise<UserMatchStats> {
  const sourceRows = await prisma.stagingSource.findMany({
    where: { projectId, object: "User" },
    select: { sourceId: true, raw: true },
  });
  if (sourceRows.length === 0) return { skipped: "no source Users extracted" };

  let conn: Connection;
  try {
    ({ conn } = await getLiveConnection(projectId, "target"));
  } catch (e) {
    return { skipped: `target org not connected: ${(e as Error).message}` };
  }

  const sourceUsers: DirectoryUser[] = sourceRows.map((r) => {
    const raw = r.raw as Record<string, unknown>;
    return {
      id: r.sourceId,
      username: typeof raw.Username === "string" ? raw.Username : null,
      email: typeof raw.Email === "string" ? raw.Email : null,
    };
  });

  // v1 limitation: a single query batch (no pagination past this cap). Large
  // orgs with 2000+ users would need cursor-based pagination — future work.
  const res = await conn.query<{ Id: string; Username: string; Email: string | null }>(
    "SELECT Id, Username, Email FROM User LIMIT 2000",
  );
  const targetUsers: DirectoryUser[] = res.records.map((u) => ({
    id: u.Id,
    username: u.Username,
    email: u.Email,
  }));

  const matches = matchUsersByEmailOrUsername(sourceUsers, targetUsers);

  await prisma.idXref.deleteMany({ where: { projectId, sourceObject: "User" } });
  if (matches.size > 0) {
    const rows: Prisma.IdXrefCreateManyInput[] = Array.from(matches.entries()).map(
      ([sourceId, targetId]) => ({
        projectId,
        sourceObject: "User",
        sourceId,
        targetObject: "User",
        targetId,
        legacyExtId: sourceId,
      }),
    );
    await prisma.idXref.createMany({ data: rows });
  }

  return { sourceCount: sourceUsers.length, targetCount: targetUsers.length, matched: matches.size };
}

/** Load the source User -> target User id map built by matchAndXrefUsers. */
export async function loadUserXrefMap(projectId: string): Promise<Map<string, string>> {
  const rows = await prisma.idXref.findMany({
    where: { projectId, sourceObject: "User", targetId: { not: null } },
    select: { sourceId: true, targetId: true },
  });
  return new Map(rows.map((r) => [r.sourceId, r.targetId as string]));
}
