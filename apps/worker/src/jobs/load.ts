import { prisma } from "@opennpc/db";
import { QUEUES, type PgBoss } from "@opennpc/core";
import { TARGET_LOAD_ORDER, LEGACY_EXTERNAL_ID_FIELD } from "@opennpc/mapping";
import { bulkUpsert } from "@opennpc/salesforce";
import { getLiveConnection } from "../lib/sfSession.js";
import { updateStageStatusFromObjects } from "../lib/stage.js";

const BATCH = 5000;

function orderIndex(objectApiName: string): number {
  const i = TARGET_LOAD_ORDER.indexOf(objectApiName);
  return i === -1 ? TARGET_LOAD_ORDER.length : i;
}

/**
 * Load planner: create an object_run per target object that has staged records,
 * then enqueue the FIRST one in dependency order. Each object chains the next on
 * success, so parents load before children (see docs/05 §7).
 */
export async function runLoadPlan(boss: PgBoss, stageRunId: string): Promise<void> {
  const stageRun = await prisma.stageRun.findUnique({ where: { id: stageRunId } });
  if (!stageRun) throw new Error(`stage_run ${stageRunId} not found`);
  const { projectId } = stageRun;

  const groups = await prisma.stagingTarget.groupBy({
    by: ["targetObject"],
    where: { projectId },
    _count: true,
  });
  const ordered = groups
    .map((g) => g.targetObject)
    .sort((a, b) => orderIndex(a) - orderIndex(b));

  if (ordered.length === 0) {
    await prisma.stageRun.update({
      where: { id: stageRunId },
      data: { status: "AWAITING_REVIEW", finishedAt: new Date(), stats: { objects: 0 } },
    });
    return;
  }

  await prisma.stageRun.update({
    where: { id: stageRunId },
    data: { status: "RUNNING", stats: { objects: ordered.length } },
  });

  let firstId: string | null = null;
  for (const object of ordered) {
    const objectRun = await prisma.objectRun.create({
      data: { stageRunId, objectApiName: object, status: "PENDING" },
    });
    if (!firstId) firstId = objectRun.id;
  }
  if (firstId) await boss.send(QUEUES.LOAD_OBJECT, { objectRunId: firstId });
}

/** Enqueue the next still-PENDING object for a stage, in dependency order. */
async function enqueueNextLoadObject(boss: PgBoss, stageRunId: string): Promise<void> {
  const pending = await prisma.objectRun.findMany({
    where: { stageRunId, status: "PENDING" },
  });
  if (pending.length === 0) return;
  pending.sort((a, b) => orderIndex(a.objectApiName) - orderIndex(b.objectApiName));
  await boss.send(QUEUES.LOAD_OBJECT, { objectRunId: pending[0]!.id });
}

/**
 * Load one target object: Bulk 2.0 upsert its staging_target rows into NPC keyed on
 * Legacy_NPSP_Id__c, capture new target ids into id_xref + staging_target, and record
 * per-record failures. On success (incl. partial) chains the next object; on a hard
 * failure the chain stops so children aren't loaded before a failed parent.
 */
export async function runLoadObject(boss: PgBoss, objectRunId: string): Promise<void> {
  const objectRun = await prisma.objectRun.findUnique({
    where: { id: objectRunId },
    include: { stageRun: true },
  });
  if (!objectRun) throw new Error(`object_run ${objectRunId} not found`);

  const { projectId } = objectRun.stageRun;
  const targetObject = objectRun.objectApiName;

  await prisma.objectRun.update({
    where: { id: objectRunId },
    data: { status: "RUNNING", startedAt: new Date(), processedCount: 0, failedCount: 0 },
  });

  try {
    const { conn } = await getLiveConnection(projectId, "target");
    let loaded = 0;
    let failed = 0;
    let skip = 0;

    for (;;) {
      const rows = await prisma.stagingTarget.findMany({
        where: { projectId, targetObject },
        orderBy: { id: "asc" },
        take: BATCH,
        skip,
      });
      if (rows.length === 0) break;

      const records = rows.map((r) => r.transformed as Record<string, unknown>);
      const { successes, failures } = await bulkUpsert(
        conn,
        targetObject,
        LEGACY_EXTERNAL_ID_FIELD,
        records,
      );

      for (const s of successes) {
        await prisma.idXref.updateMany({
          where: { projectId, sourceId: s.externalId },
          data: { targetId: s.targetId },
        });
        await prisma.stagingTarget.updateMany({
          where: { projectId, targetObject, sourceRef: s.externalId },
          data: { targetId: s.targetId, loadStatus: "loaded", error: null },
        });
      }
      for (const f of failures) {
        await prisma.stagingTarget.updateMany({
          where: { projectId, targetObject, sourceRef: f.externalId },
          data: { loadStatus: "error", error: f.error },
        });
        await prisma.migrationError.create({
          data: {
            projectId,
            objectRunId,
            stage: "load",
            object: targetObject,
            sourceId: f.externalId,
            message: f.error,
            retryable: true,
          },
        });
      }

      loaded += successes.length;
      failed += failures.length;
      await prisma.objectRun.update({
        where: { id: objectRunId },
        data: { processedCount: loaded, failedCount: failed },
      });
      skip += BATCH;
    }

    await prisma.objectRun.update({
      where: { id: objectRunId },
      data: { status: failed > 0 ? "PARTIAL" : "COMPLETED", finishedAt: new Date() },
    });
    // Parent loaded (fully or partially) — continue with the next object.
    await enqueueNextLoadObject(boss, objectRun.stageRunId);
  } catch (e) {
    const message = (e as Error).message;
    console.error(`[worker] load.object ${targetObject} FAILED: ${message}`);
    await prisma.objectRun.update({
      where: { id: objectRunId },
      data: { status: "FAILED", finishedAt: new Date() },
    });
    await prisma.migrationError.create({
      data: { projectId, objectRunId, stage: "load", object: targetObject, message, retryable: true },
    });
    // Do NOT chain the next object — children must not load before a failed parent.
    throw e;
  } finally {
    await updateStageStatusFromObjects(objectRun.stageRunId);
  }
}
