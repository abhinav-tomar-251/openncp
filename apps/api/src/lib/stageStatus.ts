import { prisma } from "@opennpc/db";
import type { StageName, StageStatus } from "@opennpc/core";

/**
 * The latest status of every stage that has been run for a project, keyed by
 * stage name. Feeds `canStartStage` (the review-gate check) — a stage may only
 * start once its predecessor's latest run is APPROVED or DONE.
 */
export async function getLatestStatusByStage(
  projectId: string,
): Promise<Partial<Record<StageName, StageStatus>>> {
  const runs = await prisma.stageRun.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: { stage: true, status: true },
  });
  const byStage: Partial<Record<StageName, StageStatus>> = {};
  for (const run of runs) {
    const stage = run.stage as StageName;
    // Rows are ordered newest-first, so the first one seen per stage is the latest.
    if (!(stage in byStage)) byStage[stage] = run.status as StageStatus;
  }
  return byStage;
}
