import { prisma, type Prisma } from "@opennpc/db";
import { prepareExternalIdFields } from "@opennpc/salesforce";
import { targetObjectsFromMappings } from "@opennpc/mapping";
import { getLiveConnection } from "../lib/sfSession.js";
import { loadProjectMappings } from "../lib/mappings.js";

/**
 * Prepare the target NPC org's schema: ensure the external-ID field exists on each
 * target object the (enabled, DB-backed) mappings write to. Results are stored on
 * the target org_connection's tokenMeta so the UI can show them. See docs/07 §4.
 */
export async function runPrepareTarget(projectId: string): Promise<void> {
  const { conn } = await getLiveConnection(projectId, "target");
  const objects = targetObjectsFromMappings(await loadProjectMappings(projectId));
  const results = await prepareExternalIdFields(conn, objects);

  const target = await prisma.orgConnection.findUnique({
    where: { projectId_role: { projectId, role: "target" } },
  });
  const meta = (target?.tokenMeta ?? {}) as Record<string, unknown>;

  await prisma.orgConnection.update({
    where: { projectId_role: { projectId, role: "target" } },
    data: {
      tokenMeta: {
        ...meta,
        targetPrep: { at: new Date().toISOString(), results },
      } as unknown as Prisma.InputJsonValue,
    },
  });

  const summary = results
    .map((r) => (r.outcome === "error" ? `${r.object}=error (${r.message})` : `${r.object}=${r.outcome}`))
    .join(", ");
  console.log(`[worker] prepare.target done: ${summary}`);
}
