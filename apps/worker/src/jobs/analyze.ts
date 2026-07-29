import { prisma, type Prisma } from "@opennpc/db";
import {
  discoverSourceObjects,
  checkTargetSchema,
  discoverAllObjects,
  captureOrgConfigAudit,
  isNpspNamespacedObject,
  type OrgConfigAudit,
  type FieldMeta,
} from "@opennpc/salesforce";
import {
  targetObjectsFromMappings,
  targetFieldsForObject,
  draftMapping,
  DEFAULT_MAPPINGS,
  type DraftObject,
  type DraftFieldMeta,
  type MappingDefinition,
} from "@opennpc/mapping";
import { getLiveConnection } from "../lib/sfSession.js";
import { draftToRow, rowToMappingDefinition } from "../lib/mappings.js";

/** Project the rich captured FieldMeta down to what the heuristic drafter consumes. */
function toDraftFields(fields: readonly FieldMeta[]): DraftFieldMeta[] {
  return fields.map((f) => ({
    name: f.name,
    label: f.label,
    type: f.type,
    required: f.required,
    picklistValues: f.picklistValues?.map((p) => p.value),
  }));
}

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
      // Full metadata is captured here (fields, record types, child relationships)
      // for the analysis report + mapping work, but stripped from the lightweight
      // GET /stages/:stage payload — the report reads it via GET /analysis.
      checkpoint: {
        label: o.label,
        custom: o.custom,
        customSetting: o.customSetting,
        fields: o.fields,
        recordTypes: o.recordTypes,
        childRelationships: o.childRelationships,
      } as unknown as Prisma.InputJsonValue,
      startedAt: new Date(),
      finishedAt: new Date(),
    })),
  });
  const sourceWithData = sourceObjects.filter((o) => o.count > 0).length;

  // Read-only org-configuration audit of the SOURCE org (validation rules, flows,
  // Apex/TDTM triggers, workflow/duplicate rules, NPSP settings). Best-effort — a
  // locked-down Tooling API or non-NPSP org must never fail Analyze.
  let sourceAudit: OrgConfigAudit | undefined;
  try {
    sourceAudit = await captureOrgConfigAudit(sourceConn);
  } catch (e) {
    console.warn(`[worker] analyze: source config audit skipped: ${(e as Error).message}`);
  }

  // --- Target org: full inventory + auto-draft the mapping layer (optional —
  // target may not be connected yet; you can't draft NPSP->NPC mappings without
  // the NPC schema) ---
  let targetChecked = 0;
  // Split by urgency: issues in mappings already ENABLED block migration now;
  // issues in still-disabled heuristic drafts are informational until reviewed.
  let targetIssuesEnabled = 0;
  let targetIssuesUnreviewed = 0;
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
          recordTypes: o.recordTypes,
          childRelationships: o.childRelationships,
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
      fields: toDraftFields(o.fields),
    }));

    // Preserve curation: rows the operator has edited (autoDrafted=false) or approved
    // are USER-OWNED and must survive re-Analyze. Only auto-drafts are refreshed. See
    // docs/sprint_four_planning/04-curation-and-suggestions.md.
    const existingRows = await prisma.mappingDefinition.findMany({ where: { projectId } });
    const protectedRows = existingRows.filter((m) => m.autoDrafted === false || m.approvedAt !== null);
    const protectedSources = new Set(protectedRows.map((m) => m.object));

    // What deserves a drafted mapping:
    //  - anything holding data, or a curated seed, OR an NPSP-namespaced object.
    //    The NPSP clause matters because sandboxes are routinely scrubbed: a real
    //    org had npe03__Recurring_Donation__c at 0 records but 157 fields, 10
    //    validation rules and 4 TDTM handlers — clearly live in production, yet it
    //    got no mapping row at all under the old `count > 0` gate.
    //  - never a Custom Setting: those are configuration (one org-default row),
    //    not migratable data, and they produced ~70% of the drafting noise.
    const draftSources = sourceObjects.filter((o) => {
      if (protectedSources.has(o.name)) return false;
      if (o.customSetting) return false;
      return o.count > 0 || o.name in DEFAULT_MAPPINGS || isNpspNamespacedObject(o.name);
    });
    const drafts = draftSources.map((o) =>
      draftMapping({ name: o.name, label: o.label, fields: toDraftFields(o.fields) }, targetDraftObjects),
    );

    // Delete ONLY auto-drafts, then recreate fresh ones — user-owned rows are untouched.
    await prisma.mappingDefinition.deleteMany({ where: { projectId, autoDrafted: true } });
    if (drafts.length > 0) {
      await prisma.mappingDefinition.createMany({
        data: drafts.map((d) => draftToRow(projectId, d)),
      });
    }
    mappingsDrafted = drafts.length;

    // Build the FULL set of mappings that make a claim about a target object —
    // curated + heuristic, enabled AND still-disabled drafts — so the schema check
    // below covers every drafted mapping, not just the handful currently enabled.
    // Track per-mapping enabled/confidence alongside so the check can attribute
    // "who targets this object" and split issues by urgency (enabled vs unreviewed).
    type MappedBy = { source: string; enabled: boolean; confidence: string };
    const allMappingsRecord: Record<string, MappingDefinition> = {};
    const mappedByTarget = new Map<string, MappedBy[]>();
    const addMapping = (source: string, target: string, def: MappingDefinition, enabled: boolean, confidence: string) => {
      allMappingsRecord[source] = def;
      const list = mappedByTarget.get(target) ?? [];
      list.push({ source, enabled, confidence });
      mappedByTarget.set(target, list);
    };
    for (const row of protectedRows) {
      if (!row.target) continue;
      const def = rowToMappingDefinition(row);
      if (def) addMapping(row.object, row.target, def, row.enabled, row.confidence ?? "manual");
    }
    for (const d of drafts) {
      if (!d.target) continue;
      const def: MappingDefinition = {
        source: d.source,
        target: d.target,
        fieldMap: d.fieldMap,
        valueMap: d.valueMap,
        lookups: d.lookups,
        constants: d.constants,
        reconcile: d.reconcile,
      };
      addMapping(d.source, d.target, def, d.enabledByDefault, d.confidence);
    }
    mappingsEnabled = [...mappedByTarget.values()].flat().filter((m) => m.enabled).length;

    // Broad, free (in-memory) check: every target object ANY mapping — curated,
    // heuristic, enabled, or still-disabled — actually claims, confirmed against
    // the full inventory just fetched above. No extra Salesforce calls: this reuses
    // allTargetObjects instead of discoverTargetSchema's old per-object describe().
    // Field-name index of the real target org, so `targetFieldsForObject` only
    // expects OwnerId/RecordTypeId where those fields actually exist. Without this
    // every readiness row WARNed with a bogus "missing fields: OwnerId".
    const targetFieldNames = new Map<string, Set<string>>(
      allTargetObjects.map((o) => [o.name, new Set(o.fields.map((f) => f.name))]),
    );
    const allTargets = targetObjectsFromMappings(allMappingsRecord);
    const checks = checkTargetSchema(allTargetObjects, allTargets, (obj) =>
      targetFieldsForObject(obj, allMappingsRecord, targetFieldNames.get(obj)),
    );
    await prisma.objectRun.createMany({
      data: checks.map((c) => {
        const outcome = !c.exists ? "MISSING" : c.missingFields.length > 0 ? "WARN" : "PASS";
        const mappedBy = mappedByTarget.get(c.name) ?? [];
        const isEnabledIssue = outcome !== "PASS" && mappedBy.some((m) => m.enabled);
        const isUnreviewedIssue = outcome !== "PASS" && !isEnabledIssue;
        if (isEnabledIssue) targetIssuesEnabled++;
        if (isUnreviewedIssue) targetIssuesUnreviewed++;
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
            mappedBy,
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
        targetIssuesEnabled,
        targetIssuesUnreviewed,
        targetObjectsFound,
        targetWithData,
        mappingsDrafted,
        mappingsEnabled,
      } as unknown as Prisma.InputJsonValue,
      // Org-config audit for the analysis report (source only; the blank NPC target
      // gets a readiness check, not a deep audit). Undefined if capture was skipped.
      audit: (sourceAudit ? { source: sourceAudit } : undefined) as unknown as Prisma.InputJsonValue,
    },
  });

  console.log(
    `[worker] analyze.plan done: ${sourceObjects.length} source objects (${sourceWithData} with data), ` +
      `${targetObjectsFound} target objects found (${targetWithData} with data), ` +
      `${mappingsDrafted} mappings drafted (${mappingsEnabled} enabled), ` +
      `${targetChecked} target checks (${targetIssuesEnabled} issues in enabled mappings, ` +
      `${targetIssuesUnreviewed} in unreviewed drafts)`,
  );
}
