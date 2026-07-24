import { prisma, type Prisma } from "@opennpc/db";
import { QUEUES, type PgBoss } from "@opennpc/core";
import { applyMapping } from "@opennpc/mapping";
import { findPersonAccountRecordTypeId } from "@opennpc/salesforce";
import { updateStageStatusFromObjects } from "../lib/stage.js";
import { getLiveConnection } from "../lib/sfSession.js";
import { matchAndXrefUsers, loadUserXrefMap } from "../lib/userXref.js";
import { loadProjectMappings } from "../lib/mappings.js";

const BATCH = 1000;

/**
 * Transform planner: build the User id_xref (for OwnerId remapping), then for
 * each source object that (a) has staging data and (b) has a mapping definition,
 * create an object_run and fan out transform.object jobs.
 */
export async function runTransformPlan(boss: PgBoss, stageRunId: string): Promise<void> {
  const stageRun = await prisma.stageRun.findUnique({ where: { id: stageRunId } });
  if (!stageRun) throw new Error(`stage_run ${stageRunId} not found`);
  const { projectId } = stageRun;

  // Build source-User -> target-User id_xref before the fundraising objects, so
  // OwnerId remapping below has something to look up. Never fails the stage —
  // worst case OwnerId is left unset and Salesforce falls back to a default owner.
  const userMatch = await matchAndXrefUsers(projectId);
  console.log(`[worker] transform.plan user match: ${JSON.stringify(userMatch)}`);

  // Mappings now come from the DB (analysis-seeded, user-editable) — no hardcoded
  // list. Only source objects with an enabled mapping proceed.
  const projectMappings = await loadProjectMappings(projectId);
  const extracted = await prisma.stagingSource.groupBy({
    by: ["object"],
    where: { projectId },
    _count: true,
  });
  const mappable = extracted
    .map((g) => g.object)
    .filter((object) => object in projectMappings)
    .sort();

  if (mappable.length === 0) {
    await prisma.stageRun.update({
      where: { id: stageRunId },
      data: {
        status: "AWAITING_REVIEW",
        finishedAt: new Date(),
        stats: { objects: 0, userMatch } as unknown as Prisma.InputJsonValue,
      },
    });
    return;
  }

  await prisma.stageRun.update({
    where: { id: stageRunId },
    data: {
      status: "RUNNING",
      stats: { objects: mappable.length, userMatch } as unknown as Prisma.InputJsonValue,
    },
  });

  for (const object of mappable) {
    const objectRun = await prisma.objectRun.create({
      data: { stageRunId, objectApiName: object, status: "PENDING" },
    });
    await boss.send(QUEUES.TRANSFORM_OBJECT, { objectRunId: objectRun.id });
  }
}

/**
 * Transform one source object's staging rows into staging_target and build id_xref.
 * Idempotent: clears this source object's prior target/xref rows first.
 *
 * Two things beyond the static field mapping are resolved here and passed to
 * applyMapping as `overrides`, because they depend on the live target org / other
 * extracted objects rather than being expressible as static mapping config:
 *  - OwnerId: remapped per-row via the User id_xref (matchAndXrefUsers).
 *  - RecordTypeId (Contact -> Person Account only): the target org's Person
 *    Account record type, resolved once per run.
 */
export async function runTransformObject(objectRunId: string): Promise<void> {
  const objectRun = await prisma.objectRun.findUnique({
    where: { id: objectRunId },
    include: { stageRun: true },
  });
  if (!objectRun) throw new Error(`object_run ${objectRunId} not found`);

  const { projectId } = objectRun.stageRun;
  const sourceObject = objectRun.objectApiName;
  const projectMappings = await loadProjectMappings(projectId);
  const def = projectMappings[sourceObject];
  if (!def) throw new Error(`no enabled mapping for ${sourceObject}`);

  await prisma.objectRun.update({
    where: { id: objectRunId },
    data: { status: "RUNNING", startedAt: new Date(), processedCount: 0, failedCount: 0 },
  });
  await prisma.stagingTarget.deleteMany({ where: { projectId, sourceObject } });
  await prisma.idXref.deleteMany({ where: { projectId, sourceObject } });

  const userXrefMap = await loadUserXrefMap(projectId);

  // Person Account record type is target-org specific and can't be a static
  // constant — resolve it once per run. Never fatal: if it can't be resolved
  // (target not connected, Person Accounts not enabled, etc.) Contact still
  // transforms, just without a RecordTypeId — Load will surface a clear
  // per-record Salesforce error rather than this job failing outright.
  let personAccountRecordTypeId: string | null = null;
  let recordTypeNote: string | null = null;
  if (sourceObject === "Contact") {
    try {
      const { conn } = await getLiveConnection(projectId, "target");
      personAccountRecordTypeId = await findPersonAccountRecordTypeId(conn);
      if (!personAccountRecordTypeId) {
        recordTypeNote = "target org has no Person Account record type (Person Accounts may be disabled)";
      }
    } catch (e) {
      recordTypeNote = `could not resolve Person Account record type: ${(e as Error).message}`;
    }
    if (recordTypeNote) console.warn(`[worker] transform.object Contact: ${recordTypeNote}`);
  }

  try {
    let processed = 0;
    let ownerRemapped = 0;
    let skip = 0;
    for (;;) {
      const rows = await prisma.stagingSource.findMany({
        where: { projectId, object: sourceObject },
        orderBy: { id: "asc" },
        take: BATCH,
        skip,
      });
      if (rows.length === 0) break;

      const targets: Prisma.StagingTargetCreateManyInput[] = [];
      const xrefs: Prisma.IdXrefCreateManyInput[] = [];
      for (const row of rows) {
        const raw = row.raw as Record<string, unknown>;
        const sourceOwnerId = raw.OwnerId;
        const targetOwnerId =
          typeof sourceOwnerId === "string" ? userXrefMap.get(sourceOwnerId) : undefined;
        if (targetOwnerId) ownerRemapped++;

        const overrides: Record<string, unknown> = { OwnerId: targetOwnerId };
        if (sourceObject === "Contact" && personAccountRecordTypeId) {
          overrides.RecordTypeId = personAccountRecordTypeId;
        }

        const res = applyMapping(raw, def, overrides);
        if (!res) continue; // filtered out
        targets.push({
          projectId,
          targetObject: res.targetObject,
          sourceObject,
          transformed: res.record as Prisma.InputJsonValue,
          sourceRef: res.sourceId,
        });
        xrefs.push({
          projectId,
          sourceObject,
          sourceId: res.sourceId,
          targetObject: res.targetObject,
          legacyExtId: res.sourceId,
        });
      }

      if (targets.length) await prisma.stagingTarget.createMany({ data: targets });
      if (xrefs.length) await prisma.idXref.createMany({ data: xrefs, skipDuplicates: true });

      processed += rows.length;
      await prisma.objectRun.update({
        where: { id: objectRunId },
        data: { processedCount: processed },
      });
      skip += BATCH;
    }

    await prisma.objectRun.update({
      where: { id: objectRunId },
      data: {
        status: "COMPLETED",
        processedCount: processed,
        finishedAt: new Date(),
        checkpoint: {
          ownerRemapped,
          ...(sourceObject === "Contact" ? { personAccountRecordTypeId, recordTypeNote } : {}),
        } as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    const message = (e as Error).message;
    console.error(`[worker] transform.object ${sourceObject} FAILED: ${message}`);
    await prisma.objectRun.update({
      where: { id: objectRunId },
      data: { status: "FAILED", finishedAt: new Date() },
    });
    await prisma.migrationError.create({
      data: { projectId, objectRunId, stage: "transform", object: sourceObject, message, retryable: true },
    });
    throw e;
  } finally {
    await updateStageStatusFromObjects(objectRun.stageRunId);
  }
}
