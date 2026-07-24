import { prisma } from "@opennpc/db";

/**
 * Fetch a project only if owned by `userId`. Returns null both when the project
 * doesn't exist and when it belongs to someone else — callers should 404 either
 * way, never 403, so a project's existence isn't leaked to non-owners.
 */
export async function getOwnedProject(userId: string, projectId: string) {
  return prisma.migrationProject.findFirst({ where: { id: projectId, ownerId: userId } });
}
