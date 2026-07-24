import { prisma, type Prisma } from "@opennpc/db";
import { QUEUES, type PgBoss } from "@opennpc/core";
import { LEGACY_EXTERNAL_ID_FIELD, type MappingDefinition } from "@opennpc/mapping";
import { aggregateByExternalId } from "@opennpc/salesforce";
import { getLiveConnection } from "../lib/sfSession.js";
import { updateStageStatusFromObjects } from "../lib/stage.js";
import { loadProjectMappings } from "../lib/mappings.js";

/** Reconciliation outcome for one object, stored in object_run.checkpoint. */
export type ReconcileOutcome = "PASS" | "PARTIAL" | "FAIL";

export interface ReconcileCheckpoint {
  sourceObject: string;
  targetObject: string;
  /** Rows staged for load (post-filter). */
  expectedCount: number;
  /** Rows this platform recorded as successfully loaded. */
  loadedCount: number;
  /** Rows this platform recorded as failed to load. */
  errorCount: number;
  /** Live COUNT() of migrated records (Legacy_NPSP_Id__c != null) in the target org. */
  liveCount: number;
  /** Local sum of the reconciled amount field over loaded rows, if configured. */
  localSum: number | null;
  /** Live SUM() in the target org, if configured. */
  liveSum: number | null;
  outcome: ReconcileOutcome;
  notes: string[];
}

/**
 * Validate planner: for each target object that has loaded rows, create an
 * object_run and fan out validate.reconcile jobs. Order doesn't matter here
 * (read-only checks), unlike Load.
 */
export async function runValidatePlan(boss: PgBoss, stageRunId: string): Promise<void> {
  const stageRun = await prisma.stageRun.findUnique({ where: { id: stageRunId } });
  if (!stageRun) throw new Error(`stage_run ${stageRunId} not found`);
  const { projectId } = stageRun;

  const groups = await prisma.stagingTarget.groupBy({
    by: ["targetObject"],
    where: { projectId, loadStatus: "loaded" },
    _count: true,
  });
  const objects = groups.map((g) => g.targetObject).sort();

  if (objects.length === 0) {
    await prisma.stageRun.update({
      where: { id: stageRunId },
      data: { status: "AWAITING_REVIEW", finishedAt: new Date(), stats: { objects: 0 } },
    });
    return;
  }

  await prisma.stageRun.update({
    where: { id: stageRunId },
    data: { status: "RUNNING", stats: { objects: objects.length } },
  });

  for (const object of objects) {
    const objectRun = await prisma.objectRun.create({
      data: { stageRunId, objectApiName: object, status: "PENDING" },
    });
    await boss.send(QUEUES.VALIDATE_RECONCILE, { objectRunId: objectRun.id });
  }
}

/** Find the mapping definition whose target matches, for reconcile config lookup. */
function mappingForTarget(
  targetObject: string,
  mappings: Record<string, MappingDefinition>,
): MappingDefinition | undefined {
  return Object.values(mappings).find((m) => m.target === targetObject);
}

/**
 * Reconcile one target object: compare local staging/load bookkeeping against a
 * live read-back from the target org (scoped to migrated records via the
 * external-id field), plus a financial total if the mapping configures one.
 * Read-only against the target org. See docs/09-validation-and-reporting.md.
 */
export async function runValidateObject(objectRunId: string): Promise<void> {
  const objectRun = await prisma.objectRun.findUnique({
    where: { id: objectRunId },
    include: { stageRun: true },
  });
  if (!objectRun) throw new Error(`object_run ${objectRunId} not found`);

  const { projectId } = objectRun.stageRun;
  const targetObject = objectRun.objectApiName;

  await prisma.objectRun.update({
    where: { id: objectRunId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  try {
    const [expectedCount, loadedCount, errorCount] = await Promise.all([
      prisma.stagingTarget.count({ where: { projectId, targetObject } }),
      prisma.stagingTarget.count({ where: { projectId, targetObject, loadStatus: "loaded" } }),
      prisma.stagingTarget.count({ where: { projectId, targetObject, loadStatus: "error" } }),
    ]);

    const mapping = mappingForTarget(targetObject, await loadProjectMappings(projectId));
    const amountField = mapping?.reconcile?.amountField;

    const { conn } = await getLiveConnection(projectId, "target");
    const live = await aggregateByExternalId(conn, targetObject, LEGACY_EXTERNAL_ID_FIELD, amountField);

    let localSum: number | null = null;
    if (amountField) {
      const loaded = await prisma.stagingTarget.findMany({
        where: { projectId, targetObject, loadStatus: "loaded" },
        select: { transformed: true },
      });
      localSum = loaded.reduce((sum, row) => {
        const v = (row.transformed as Record<string, unknown>)[amountField];
        return sum + (typeof v === "number" ? v : Number(v) || 0);
      }, 0);
    }

    const notes: string[] = [];
    if (errorCount > 0) notes.push(`${errorCount} record(s) failed to load (see errors).`);
    if (loadedCount !== expectedCount) {
      notes.push(`Loaded count (${loadedCount}) differs from staged count (${expectedCount}).`);
    }
    if (live.count !== loadedCount) {
      notes.push(`Live target count (${live.count}) differs from recorded loaded count (${loadedCount}).`);
    }
    const amountsMatch =
      localSum === null || live.sum === null || Math.abs(localSum - live.sum) < 0.01;
    if (!amountsMatch) {
      notes.push(`Amount mismatch: local ${localSum?.toFixed(2)} vs live ${live.sum?.toFixed(2)}.`);
    }

    const outcome: ReconcileOutcome =
      errorCount === 0 && loadedCount === expectedCount && live.count === loadedCount && amountsMatch
        ? "PASS"
        : loadedCount > 0
          ? "PARTIAL"
          : "FAIL";

    const checkpoint: ReconcileCheckpoint = {
      sourceObject: mapping?.source ?? "",
      targetObject,
      expectedCount,
      loadedCount,
      errorCount,
      liveCount: live.count,
      localSum,
      liveSum: live.sum,
      outcome,
      notes,
    };

    await prisma.objectRun.update({
      where: { id: objectRunId },
      data: {
        status: "COMPLETED",
        processedCount: loadedCount,
        failedCount: errorCount,
        finishedAt: new Date(),
        checkpoint: checkpoint as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    const message = (e as Error).message;
    console.error(`[worker] validate.reconcile ${targetObject} FAILED: ${message}`);
    await prisma.objectRun.update({
      where: { id: objectRunId },
      data: { status: "FAILED", finishedAt: new Date() },
    });
    await prisma.migrationError.create({
      data: { projectId, objectRunId, stage: "validate", object: targetObject, message, retryable: true },
    });
    throw e;
  } finally {
    await updateStageStatusFromObjects(objectRun.stageRunId);
  }
}
