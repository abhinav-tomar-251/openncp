import { prisma } from "@opennpc/db";
import { deriveStageStatus } from "@opennpc/core";

/**
 * Recompute a stage's status from its object runs and persist it. The worker
 * reports per-object results; the stage status is always derived, never set
 * directly. See docs/04-migration-workflow.md §3 and docs/10-api-and-jobs.md §3.
 */
export async function updateStageStatusFromObjects(stageRunId: string): Promise<void> {
  const objects = await prisma.objectRun.findMany({
    where: { stageRunId },
    select: { status: true },
  });
  const status = deriveStageStatus(objects.map((o) => o.status));
  const settled = status === "AWAITING_REVIEW" || status === "FAILED";

  await prisma.stageRun.update({
    where: { id: stageRunId },
    data: { status, ...(settled ? { finishedAt: new Date() } : {}) },
  });
}
