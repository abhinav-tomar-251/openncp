import { prisma, type Prisma } from "@opennpc/db";
import { discoverSourceObjects, discoverTargetSchema, discoverAllObjects } from "@opennpc/salesforce";
import {
  targetObjectsFromMappings,
  targetFieldsForObject,
  draftMapping,
  DEFAULT_MAPPINGS,
  type DraftObject,
  type MappingDefinition,
} from "@opennpc/mapping";
import { getLiveConnection } from "../lib/sfSession.js";
import { draftToRow } from "../lib/mappings.js";

/**
 * Analyze stage: discover what each org actually contains before Extract/Transform
 * ever assume a fixed object list. No per-object queue — a describe+count pass is
 * cheap enough to run inline, unlike Extract/Load's heavy Bulk jobs. See the plan
 * that introduced this file and docs/04-migration-workflow.md.
 */
export async function runAnalyzePlan(stageRunId: string): Promise<void> {
  const stageRun = await prisma.stageRun.findUnique({ where: { id: stageRunId } });
  if (!stageRun) throw new Error(`stage_run ${stageRunId} not found`);
  const { projectId } = stageRun;

  await prisma.stageRun.update({ where: { id: stageRunId }, data: { status: "RUNNING" } });
  // Idempotent re-run: clear this project's prior Analyze object_runs (both roles).
  await prisma.objectRun.deleteMany({ where: { stageRunId } });

  // --- Source org: full object inventory (required) ---
  const { conn: sourceConn } = await getLiveConnection(projectId, "source");
  const sourceObjects = await discoverSourceObjects(sourceConn);

  await prisma.objectRun.createMany({
    data: sourceObjects.map((o) => ({
      stageRunId,
      objectApiName: o.name,
      role: "source" as const,
      status: "COMPLETED" as const,
      processedCount: o.count,
      // Full field metadata is captured here for future mapping work (see the
      // plan that introduced this) but deliberately stripped from the API
      // response the web UI fetches — see GET /stages/:stage in stages.ts.
      checkpoint: {
        label: o.label,
        custom: o.custom,
        fields: o.fields,
      } as unknown as Prisma.InputJsonValue,
      startedAt: new Date(),
      finishedAt: new Date(),
    })),
  });
  const sourceWithData = sourceObjects.filter((o) => o.count > 0).length;

  // --- Target org: full inventory + auto-draft the mapping layer (optional —
  // target may not be connected yet; you can't draft NPSP->NPC mappings without
  // the NPC schema) ---
  let targetChecked = 0;
  let targetIssues = 0;
  let targetObjectsFound = 0;
  let targetWithData = 0;
  let mappingsDrafted = 0;
  let mappingsEnabled = 0;
  try {
    const { conn: targetConn } = await getLiveConnection(projectId, "target");

    // Full browsable inventory of the target org — this is both the "what does the
    // NPC org actually have" answer AND the candidate pool the drafter matches
    // against. Fetched first because drafting depends on it.
    const allTargetObjects = await discoverAllObjects(targetConn);
    await prisma.objectRun.createMany({
      data: allTargetObjects.map((o) => ({
        stageRunId,
        objectApiName: `target:${o.name}`,
        role: "target" as const,
        status: "COMPLETED" as const,
        processedCount: o.count,
        checkpoint: {
          label: o.label,
          custom: o.custom,
          fields: o.fields,
        } as unknown as Prisma.InputJsonValue,
        startedAt: new Date(),
        finishedAt: new Date(),
      })),
    });
    targetObjectsFound = allTargetObjects.length;
    targetWithData = allTargetObjects.filter((o) => o.count > 0).length;

    // --- Auto-draft the mapping layer for the WHOLE org (no hardcoded list) ---
    // Draft a mapping for every source object that has data (or is a curated seed),
    // matching against the real target inventory. Curated seeds are enabled; every
    // other draft is disabled pending review. Persisted to mapping_definition; the
    // pipeline (transform/prepare-target/validate) reads these instead of a constant.
    const targetDraftObjects: DraftObject[] = allTargetObjects.map((o) => ({
      name: o.name,
      label: o.label,
      fields: o.fields.map((fld) => ({ name: fld.name, label: fld.label, type: fld.type })),
    }));
    const draftSources = sourceObjects.filter((o) => o.count > 0 || o.name in DEFAULT_MAPPINGS);
    const drafts = draftSources.map((o) =>
      draftMapping(
        { name: o.name, label: o.label, fields: o.fields.map((fld) => ({ name: fld.name, label: fld.label, type: fld.type })) },
        targetDraftObjects,
      ),
    );

    // Idempotent re-seed: replace this project's mapping rows every Analyze run.
    await prisma.mappingDefinition.deleteMany({ where: { projectId } });
    if (drafts.length > 0) {
      await prisma.mappingDefinition.createMany({
        data: drafts.map((d) => draftToRow(projectId, d)),
      });
    }
    mappingsDrafted = drafts.length;

    // The enabled (curated) mappings drive the narrow schema check below.
    const enabledMappings: Record<string, MappingDefinition> = {};
    for (const d of drafts) {
      if (d.enabledByDefault && d.target) {
        enabledMappings[d.source] = {
          source: d.source,
          target: d.target,
          fieldMap: d.fieldMap,
          valueMap: d.valueMap,
          lookups: d.lookups,
          constants: d.constants,
          reconcile: d.reconcile,
        };
      }
    }
    mappingsEnabled = Object.keys(enabledMappings).length;

    // Narrow check: confirm the ENABLED mappings' target objects exist with the
    // expected fields (grows/shrinks with what's enabled — no longer a flat 6).
    const narrowTargets = targetObjectsFromMappings(enabledMappings);
    const checks = await discoverTargetSchema(targetConn, narrowTargets, (obj) =>
      targetFieldsForObject(obj, enabledMappings),
    );
    await prisma.objectRun.createMany({
      data: checks.map((c) => {
        const outcome = !c.exists ? "MISSING" : c.missingFields.length > 0 ? "WARN" : "PASS";
        if (outcome !== "PASS") targetIssues++;
        return {
          stageRunId,
          objectApiName: c.name,
          role: "target" as const,
          status: "COMPLETED" as const,
          checkpoint: {
            exists: c.exists,
            missingFields: c.missingFields,
            suggestions: c.suggestions,
            suggestionDetails: c.suggestionDetails,
            outcome,
          } as unknown as Prisma.InputJsonValue,
          startedAt: new Date(),
          finishedAt: new Date(),
        };
      }),
    });
    targetChecked = checks.length;
  } catch (e) {
    console.warn(`[worker] analyze.plan: target-side / drafting skipped: ${(e as Error).message}`);
  }

  await prisma.stageRun.update({
    where: { id: stageRunId },
    data: {
      status: "AWAITING_REVIEW",
      finishedAt: new Date(),
      stats: {
        sourceObjects: sourceObjects.length,
        sourceWithData,
        targetChecked,
        targetIssues,
        targetObjectsFound,
        targetWithData,
        mappingsDrafted,
        mappingsEnabled,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  console.log(
    `[worker] analyze.plan done: ${sourceObjects.length} source objects (${sourceWithData} with data), ` +
      `${targetObjectsFound} target objects found (${targetWithData} with data), ` +
      `${mappingsDrafted} mappings drafted (${mappingsEnabled} enabled), ` +
      `${targetChecked} enabled-target checks (${targetIssues} issues)`,
  );
}
