import { prisma, type Prisma } from "@opennpc/db";
import { QUEUES, type PgBoss } from "@opennpc/core";
import {
  DEFAULT_SOURCE_OBJECTS,
  listPresentObjects,
  getSelectableFields,
  buildSelectSoql,
  bulkQuery,
} from "@opennpc/salesforce";
import { getLiveConnection } from "../lib/sfSession.js";
import { updateStageStatusFromObjects } from "../lib/stage.js";

const BATCH = Number(process.env.BULK_BATCH_SIZE ?? 10000);

/**
 * The Analyze stage's discovered source-object list for this project, if Analyze
 * has been run (and, per the review gate, approved before Extract could start).
 * Only objects Analyze found with actual records are included. Returns null if no
 * Analyze run exists yet, so callers can fall back to the static catalog.
 */
async function analyzedSourceObjects(projectId: string): Promise<string[] | null> {
  const latestAnalyze = await prisma.stageRun.findFirst({
    where: { projectId, stage: "analyze" },
    orderBy: { createdAt: "desc" },
    include: { objectRuns: { where: { role: "source", processedCount: { gt: 0 } } } },
  });
  if (!latestAnalyze || latestAnalyze.objectRuns.length === 0) return null;
  return latestAnalyze.objectRuns.map((o) => o.objectApiName);
}

/**
 * Extract planner: discover which in-scope source objects exist, create an
 * object_run per object, and fan out extract.object jobs. Prefers the Analyze
 * stage's live discovery of the org's actual objects; falls back to the static
 * catalog if Analyze hasn't been run for this project yet.
 */
export async function runExtractPlan(boss: PgBoss, stageRunId: string): Promise<void> {
  const stageRun = await prisma.stageRun.findUnique({ where: { id: stageRunId } });
  if (!stageRun) throw new Error(`stage_run ${stageRunId} not found`);
  const { projectId } = stageRun;

  const { conn } = await getLiveConnection(projectId, "source");
  const candidates = (await analyzedSourceObjects(projectId)) ?? DEFAULT_SOURCE_OBJECTS;
  const present = await listPresentObjects(conn, candidates);

  if (present.length === 0) {
    await prisma.stageRun.update({
      where: { id: stageRunId },
      data: { status: "AWAITING_REVIEW", finishedAt: new Date(), stats: { objects: 0 } },
    });
    return;
  }

  await prisma.stageRun.update({
    where: { id: stageRunId },
    data: { status: "RUNNING", stats: { objects: present.length } },
  });

  for (const object of present) {
    const objectRun = await prisma.objectRun.create({
      data: { stageRunId, objectApiName: object, status: "PENDING" },
    });
    await boss.send(QUEUES.EXTRACT_OBJECT, { objectRunId: objectRun.id });
  }
}

/**
 * Extract one object via Bulk API 2.0 into staging_source. Idempotent: clears any
 * prior staging rows for the object first, so a re-run (after a failure/kill)
 * produces a clean result rather than duplicates.
 */
export async function runExtractObject(objectRunId: string): Promise<void> {
  const objectRun = await prisma.objectRun.findUnique({
    where: { id: objectRunId },
    include: { stageRun: true },
  });
  if (!objectRun) throw new Error(`object_run ${objectRunId} not found`);

  const { projectId } = objectRun.stageRun;
  const object = objectRun.objectApiName;

  await prisma.objectRun.update({
    where: { id: objectRunId },
    data: { status: "RUNNING", startedAt: new Date(), processedCount: 0, failedCount: 0 },
  });
  await prisma.stagingSource.deleteMany({ where: { projectId, object } });

  try {
    const { conn } = await getLiveConnection(projectId, "source");
    const fields = await getSelectableFields(conn, object);
    const soql = buildSelectSoql(
      object,
      fields.map((f) => f.name),
    );

    let total = 0;
    await bulkQuery(conn, {
      soql,
      batchSize: BATCH,
      onBatch: async (records) => {
        await prisma.stagingSource.createMany({
          data: records.map((r) => ({
            projectId,
            object,
            sourceId: String(r.Id ?? r.id ?? ""),
            raw: r as Prisma.InputJsonValue,
            extractRunId: objectRunId,
          })),
        });
      },
      onProgress: async (t) => {
        total = t;
        await prisma.objectRun.update({
          where: { id: objectRunId },
          data: { processedCount: t },
        });
      },
    });

    await prisma.objectRun.update({
      where: { id: objectRunId },
      data: {
        status: "COMPLETED",
        processedCount: total,
        finishedAt: new Date(),
        checkpoint: { total } as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    const message = (e as Error).message;
    console.error(`[worker] extract.object ${object} FAILED: ${message}`);
    await prisma.objectRun.update({
      where: { id: objectRunId },
      data: { status: "FAILED", finishedAt: new Date() },
    });
    await prisma.migrationError.create({
      data: { projectId, objectRunId, stage: "extract", object, message, retryable: true },
    });
    throw e; // surface to pg-boss for retry/record
  } finally {
    await updateStageStatusFromObjects(objectRun.stageRunId);
  }
}
