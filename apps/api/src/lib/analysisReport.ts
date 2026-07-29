import {
  isMappableRequiredField,
  isMeaningfulPolymorphicLookup,
  type FieldMeta,
  type RecordTypeMeta,
  type ChildRelationshipMeta,
  type OrgConfigAudit,
  type CapabilityReport,
} from "@opennpc/salesforce";

/**
 * Pure builder + Markdown renderer for the NPSP Analysis Report. Takes already-loaded
 * DB data (no Salesforce calls, no Prisma) so it's fully unit-testable. The route in
 * routes/analysis.ts does the I/O and hands the raw rows here.
 * See docs/sprint_four_planning/02-analysis-report.md.
 */

// --- Inputs (structural subsets of the Prisma rows) ---

export interface ObjectRunLike {
  objectApiName: string;
  role: string | null;
  processedCount: number;
  checkpoint: unknown;
}
export interface StageRunLike {
  finishedAt: Date | null;
  audit: unknown;
  objectRuns: ObjectRunLike[];
}
export interface ConnectionLike {
  role: string;
  orgId: string | null;
  instanceUrl: string;
  apiVersion: string | null;
  tokenMeta: unknown;
}
export interface MappingRowLike {
  object: string;
  target: string | null;
  fieldMap: unknown;
  enabled: boolean;
  confidence: string | null;
}

// --- Output ---

export interface ReportObject {
  name: string;
  label: string;
  custom: boolean;
  /** Hierarchy/list Custom Setting — configuration, not migratable data. */
  customSetting: boolean;
  count: number;
  fields: FieldMeta[];
  recordTypes: RecordTypeMeta[];
  childRelationships: ChildRelationshipMeta[];
  lookups: { field: string; referenceTo: string[] }[];
}
export interface MappedByEntry {
  source: string;
  enabled: boolean;
  confidence: string;
}
export interface TargetReadinessRow {
  object: string;
  label: string;
  count: number;
  fieldCount: number;
  exists: boolean;
  missingFields: string[];
  suggestions: string[];
  /** UNMAPPED = exists in the target org but no mapping currently targets it. */
  outcome: "PASS" | "WARN" | "MISSING" | "UNMAPPED";
  /** Which source object(s) target this, and whether that mapping is enabled. */
  mappedBy: MappedByEntry[];
}
export interface Warning {
  severity: "info" | "warn" | "blocker";
  kind: string;
  object?: string;
  message: string;
  /** Plain-language NPSP<->NPC context: why this happens. */
  why?: string;
  /** Concrete next step for the operator. */
  action?: string;
}
export interface AnalysisReport {
  meta: {
    projectName: string;
    generatedAt: string;
    analyzedAt: string | null;
    source: { orgId: string | null; instanceUrl: string; apiVersion: string | null } | null;
    target: { orgId: string | null; instanceUrl: string; apiVersion: string | null } | null;
    capability: CapabilityReport | null;
  };
  source: {
    objectCount: number;
    objectsWithData: number;
    totalRecords: number;
    objects: ReportObject[];
    config: OrgConfigAudit | null;
  };
  targetReadiness: TargetReadinessRow[];
  targetSummary: {
    total: number;
    mapped: number;
    unmapped: number;
    issuesEnabled: number;
    issuesUnreviewed: number;
  };
  mappings: {
    drafted: number;
    enabled: number;
    unmapped: number;
    rows: { source: string; target: string | null; confidence: string; fieldCount: number; enabled: boolean }[];
  };
  warnings: Warning[];
}

// --- Safe JSON parsing helpers ---

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

const LARGE_OBJECT_THRESHOLD = 100_000;

function toReportObject(run: ObjectRunLike): ReportObject {
  const cp = asRecord(run.checkpoint);
  const fields = asArray<FieldMeta>(cp.fields);
  return {
    name: run.objectApiName,
    label: asString(cp.label, run.objectApiName),
    custom: cp.custom === true,
    customSetting: cp.customSetting === true,
    count: run.processedCount,
    fields,
    recordTypes: asArray<RecordTypeMeta>(cp.recordTypes),
    childRelationships: asArray<ChildRelationshipMeta>(cp.childRelationships),
    lookups: fields
      .filter((f) => f.referenceTo && f.referenceTo.length > 0)
      .map((f) => ({ field: f.name, referenceTo: f.referenceTo ?? [] })),
  };
}

/**
 * Triage rank for a readiness row: 0 = issue in an ENABLED mapping (blocks migration
 * now), 1 = issue in a still-disabled/unreviewed draft (informational), 2 = healthy
 * mapped object, 3 = unmapped (exists, nothing targets it — lowest priority to review).
 */
function readinessRank(r: TargetReadinessRow): 0 | 1 | 2 | 3 {
  if (r.outcome === "PASS") return 2;
  if (r.outcome === "UNMAPPED") return 3;
  return r.mappedBy.some((m) => m.enabled) ? 0 : 1;
}

/** Extract the capability report from a connection's tokenMeta, if present and valid. */
function capabilityOf(conn: ConnectionLike | undefined): CapabilityReport | null {
  if (!conn) return null;
  const cap = asRecord(conn.tokenMeta).capability;
  const rec = asRecord(cap);
  return "orgId" in rec ? (cap as CapabilityReport) : null;
}

/**
 * Join the target org's full inventory with the (broadened) target-schema check
 * rows into ONE readiness table covering every target object: mapped (curated or
 * heuristic, enabled or still-disabled) gets its real PASS/WARN/MISSING outcome;
 * everything else in the inventory that nothing currently maps to gets UNMAPPED.
 * Pure — reused by both the full Analysis Report and the lightweight Analyze stage
 * payload (apps/api/src/routes/stages.ts), so the project page's live view and the
 * downloadable report always agree. See the plan that widened this check.
 */
export function buildTargetReadiness(objectRuns: readonly ObjectRunLike[]): {
  targetReadiness: TargetReadinessRow[];
  targetSummary: AnalysisReport["targetSummary"];
} {
  // Target inventory (role="target", "target:"-prefixed) — the FULL org, used both
  // for required-field diffing and to synthesize UNMAPPED rows below.
  const targetFieldsByObject = new Map<string, FieldMeta[]>();
  const targetInventoryMeta = new Map<string, { label: string; count: number }>();
  for (const o of objectRuns) {
    if (o.role === "target" && o.objectApiName.startsWith("target:")) {
      const name = o.objectApiName.slice("target:".length);
      const cp = asRecord(o.checkpoint);
      targetFieldsByObject.set(name, asArray<FieldMeta>(cp.fields));
      targetInventoryMeta.set(name, { label: asString(cp.label, name), count: o.processedCount });
    }
  }

  // Target readiness: role="target", un-prefixed schema-check runs — one per target
  // object ANY mapping claims (curated/heuristic, enabled/unreviewed). Joined against
  // the full inventory above so objects nothing maps to still appear, as UNMAPPED.
  const checkByName = new Map<string, ObjectRunLike>(
    objectRuns
      .filter((o) => o.role === "target" && !o.objectApiName.startsWith("target:"))
      .map((o) => [o.objectApiName, o]),
  );
  const allTargetNames = new Set<string>([...targetInventoryMeta.keys(), ...checkByName.keys()]);
  const targetReadiness: TargetReadinessRow[] = Array.from(allTargetNames)
    .map((name): TargetReadinessRow => {
      const meta = targetInventoryMeta.get(name);
      const fieldCount = targetFieldsByObject.get(name)?.length ?? 0;
      const checkRow = checkByName.get(name);
      if (!checkRow) {
        // In the inventory, but no mapping currently targets it.
        return {
          object: name,
          label: meta?.label ?? name,
          count: meta?.count ?? 0,
          fieldCount,
          exists: true,
          missingFields: [],
          suggestions: [],
          outcome: "UNMAPPED",
          mappedBy: [],
        };
      }
      const cp = asRecord(checkRow.checkpoint);
      return {
        object: name,
        label: meta?.label ?? name,
        count: meta?.count ?? 0,
        fieldCount,
        exists: cp.exists === true,
        missingFields: asArray<string>(cp.missingFields),
        suggestions: asArray<string>(cp.suggestions),
        outcome: asString(cp.outcome, "PASS") as TargetReadinessRow["outcome"],
        mappedBy: asArray<MappedByEntry>(cp.mappedBy),
      };
    })
    .sort((a, b) => readinessRank(a) - readinessRank(b) || a.object.localeCompare(b.object));

  const targetSummary = {
    total: targetReadiness.length,
    mapped: targetReadiness.filter((r) => r.outcome !== "UNMAPPED").length,
    unmapped: targetReadiness.filter((r) => r.outcome === "UNMAPPED").length,
    issuesEnabled: targetReadiness.filter((r) => readinessRank(r) === 0).length,
    issuesUnreviewed: targetReadiness.filter((r) => readinessRank(r) === 1).length,
  };

  return { targetReadiness, targetSummary };
}

/** Build the structured analysis report from loaded DB rows. Pure. */
export function buildAnalysisReport(
  projectName: string,
  stageRun: StageRunLike,
  mappings: MappingRowLike[],
  connections: ConnectionLike[],
): AnalysisReport {
  const source = connections.find((c) => c.role === "source");
  const target = connections.find((c) => c.role === "target");

  // Source inventory: role="source" object runs.
  const sourceObjects = stageRun.objectRuns
    .filter((o) => o.role === "source")
    .map(toReportObject)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const { targetReadiness, targetSummary } = buildTargetReadiness(stageRun.objectRuns);

  // Required-field diffing in deriveWarnings still needs the raw field lists.
  const targetFieldsByObject = new Map<string, FieldMeta[]>();
  for (const o of stageRun.objectRuns) {
    if (o.role === "target" && o.objectApiName.startsWith("target:")) {
      targetFieldsByObject.set(o.objectApiName.slice("target:".length), asArray<FieldMeta>(asRecord(o.checkpoint).fields));
    }
  }

  const audit = asRecord(stageRun.audit);
  const sourceConfig = (audit.source ?? null) as OrgConfigAudit | null;

  const mappingRows = mappings
    .map((m) => ({
      source: m.object,
      target: m.target,
      confidence: m.confidence ?? "manual",
      fieldCount: Object.keys(asRecord(m.fieldMap)).length,
      enabled: m.enabled,
    }))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.source.localeCompare(b.source));

  const warnings = deriveWarnings(sourceObjects, mappings, targetReadiness, targetFieldsByObject, sourceConfig);

  return {
    meta: {
      projectName,
      generatedAt: new Date().toISOString(),
      analyzedAt: stageRun.finishedAt ? stageRun.finishedAt.toISOString() : null,
      source: source ? { orgId: source.orgId, instanceUrl: source.instanceUrl, apiVersion: source.apiVersion } : null,
      target: target ? { orgId: target.orgId, instanceUrl: target.instanceUrl, apiVersion: target.apiVersion } : null,
      capability: capabilityOf(source),
    },
    source: {
      objectCount: sourceObjects.length,
      objectsWithData: sourceObjects.filter((o) => o.count > 0).length,
      totalRecords: sourceObjects.reduce((sum, o) => sum + o.count, 0),
      objects: sourceObjects,
      config: sourceConfig,
    },
    targetReadiness,
    targetSummary,
    mappings: {
      drafted: mappings.length,
      enabled: mappings.filter((m) => m.enabled).length,
      unmapped: mappings.filter((m) => !m.target).length,
      rows: mappingRows,
    },
    warnings,
  };
}

/** Standard-object markers for a working Nonprofit Cloud for Fundraising setup. */
const FUNDRAISING_MARKER_OBJECTS = ["GiftTransaction", "GiftCommitment", "Designation"];

/** Cross-reference inventory × mappings × readiness × audit into actionable warnings. Pure. */
export function deriveWarnings(
  sourceObjects: ReportObject[],
  mappings: MappingRowLike[],
  targetReadiness: TargetReadinessRow[],
  targetFieldsByObject: Map<string, FieldMeta[]>,
  config: OrgConfigAudit | null,
): Warning[] {
  const warnings: Warning[] = [];
  const mappingByObject = new Map(mappings.map((m) => [m.object, m]));
  const readinessByObject = new Map(targetReadiness.map((r) => [r.object, r]));

  // Target org connected but Nonprofit Cloud for Fundraising hasn't been turned on yet —
  // none of the Gift*/Designation standard objects exist. This is an org-Setup problem,
  // not a mapping problem; catch it once here so the operator doesn't see a confusing wall
  // of per-object MISSING rows below and mistake it for a bad mapping guess.
  if (targetFieldsByObject.size > 0 && !FUNDRAISING_MARKER_OBJECTS.some((o) => targetFieldsByObject.has(o))) {
    warnings.push({
      severity: "blocker",
      kind: "fundraising-not-enabled",
      message: "The target NPC org doesn't appear to have Nonprofit Cloud for Fundraising enabled yet.",
      why:
        "A newly created NPC org doesn't have GiftTransaction, GiftCommitment, or Designation until an " +
        "admin turns on Person Accounts and Nonprofit Cloud for Fundraising in Setup. Until then, every " +
        "mapping that targets those objects will show as MISSING below — that's a symptom of this, not a " +
        "mapping mistake.",
      action: "Enable Person Accounts and Nonprofit Cloud for Fundraising in the target org's Setup, then re-run Analyze. See the Guide → Prepare the blank NPC org.",
    });
  }

  // Two mappings writing to the same target object: the transform engine will
  // happily produce both, but reconcile config and load ordering pick arbitrarily,
  // and a Person-Account mapping colliding with a raw Account copy silently
  // double-writes. Surface it rather than letting it pass (real org: Contact and
  // Account both targeted Account).
  const byTarget = new Map<string, string[]>();
  for (const m of mappings) {
    if (!m.target) continue;
    byTarget.set(m.target, [...(byTarget.get(m.target) ?? []), m.object]);
  }
  for (const [target, sources] of byTarget) {
    if (sources.length < 2) continue;
    warnings.push({
      severity: "warn",
      kind: "multi-source-same-target",
      message: `${sources.join(", ")} all map to ${target}.`,
      why:
        "Several source objects writing to one target object can double-write records, and the " +
        "reconciliation config for that target is taken from whichever mapping is found first.",
      action: `Confirm this is intended (e.g. Person Accounts and Business Accounts both land on Account), or disable the mappings you don't want in the Mapping Editor.`,
    });
  }

  for (const obj of sourceObjects) {
    const mapping = mappingByObject.get(obj.name);

    // Custom Settings are configuration (one org-default row), never migratable
    // data — they generated ~70% of this section's noise on a real org.
    if (obj.customSetting) continue;

    // Populated source object with no target chosen.
    if (obj.count > 0 && (!mapping || !mapping.target)) {
      warnings.push({
        severity: "warn",
        kind: "unmapped-object-with-data",
        object: obj.name,
        message: `${obj.name} has ${obj.count.toLocaleString()} record(s) but no target object mapped.`,
        why:
          "NPSP objects don't all have one obvious NPC home — some translate 1:1 (e.g. Campaign), some " +
          "need a different target object entirely (e.g. a Recurring Donation becomes a GiftCommitment, " +
          "not a copy of itself), and some genuinely have no NPC equivalent (NPSP's own staging/import " +
          "objects).",
        action: `Open the Mapping Editor and set a target object for ${obj.name} — or confirm it's meant to stay unmapped. See the Guide → NPSP vs NPC in plain language.`,
      });
    }

    // Target existence — covers BOTH enabled mappings (blocker: actually blocks
    // migration right now) and still-disabled/unreviewed drafts (info: worth
    // knowing before you enable them, not urgent). The readiness table itself now
    // covers every drafted target, so both cases are visible here.
    if (mapping?.target) {
      const readiness = readinessByObject.get(mapping.target);
      if (readiness && readiness.outcome === "MISSING") {
        if (mapping.enabled) {
          warnings.push({
            severity: "blocker",
            kind: "target-object-missing",
            object: obj.name,
            message: `Enabled mapping ${obj.name} → ${mapping.target}, but ${mapping.target} does not exist in the NPC org.`,
            why: "This usually means the target org hasn't had the feature that creates this object turned on yet, or the mapping's target object name doesn't match the org's real schema.",
            action: "Check Setup on the target org (see the fundraising-not-enabled warning above if present), or fix the mapping's target object in the Mapping Editor.",
          });
        } else {
          warnings.push({
            severity: "info",
            kind: "unreviewed-target-missing",
            object: obj.name,
            message: `Drafted mapping ${obj.name} → ${mapping.target} isn't enabled yet, and ${mapping.target} doesn't exist in the NPC org.`,
            why: "This is a heuristic guess that hasn't been reviewed yet — not urgent unless you plan to enable it as-is.",
            action: `Before enabling this mapping, fix its target object in the Mapping Editor (or leave it disabled if ${obj.name} shouldn't migrate).`,
          });
        }
      }

      // Required target fields with nothing mapped to them — only meaningful to
      // flag for mappings you've actually enabled (this is what drives Load).
      if (mapping.enabled) {
        const targetFields = targetFieldsByObject.get(mapping.target) ?? [];
        const mapped = new Set(Object.values(asRecord(mapping.fieldMap)) as string[]);
        // `required` alone over-reports: Salesforce marks read-only rollups
        // (Campaign.NumberOfContacts, AmountWonOpportunities), formulas and
        // auto-number Name fields non-nillable, but they're not createable — asking
        // the operator to map them guarantees a Load failure. See
        // isMappableRequiredField in @opennpc/salesforce.
        const unmet = targetFields
          .filter(
            (f) =>
              isMappableRequiredField(f) &&
              f.name !== "RecordTypeId" &&
              f.name !== "Legacy_NPSP_Id__c" &&
              !mapped.has(f.name),
          )
          .map((f) => f.name);
        if (unmet.length > 0) {
          warnings.push({
            severity: "warn",
            kind: "unmapped-required-target-field",
            object: obj.name,
            message: `${mapping.target} requires field(s) with no source mapping: ${unmet.join(", ")}.`,
            why: "NPC enforces required fields at the API level — Load will fail for every record missing one of these.",
            action: `Map a source field to ${unmet.join(", ")} in the Mapping Editor, or give it a constant value.`,
          });
        }
      }
    }

    // Large object — flag for Bulk/PK-chunking attention.
    if (obj.count >= LARGE_OBJECT_THRESHOLD) {
      warnings.push({
        severity: "info",
        kind: "large-object",
        object: obj.name,
        message: `${obj.name} has ${obj.count.toLocaleString()} records — plan for chunked extract/load.`,
        why: "Bulk API 2.0 chunks large objects automatically, but Extract and Load will simply take longer for this one.",
        action: "No action needed — just expect a longer run for this object.",
      });
    }

    // Polymorphic lookup — not re-linked by v1. Only genuinely relational ones:
    // OwnerId (User|Group) is polymorphic on EVERY object and SetupOwnerId on every
    // hierarchy custom setting, so counting those produced 205 of 212 pure-noise
    // warnings on a real org. See isMeaningfulPolymorphicLookup.
    const poly = obj.lookups.filter((l) => isMeaningfulPolymorphicLookup({ name: l.field, referenceTo: l.referenceTo }));
    if (poly.length > 0) {
      warnings.push({
        severity: "info",
        kind: "polymorphic-lookup-present",
        object: obj.name,
        message: `${obj.name} has polymorphic lookup(s) (${poly.map((p) => p.field).join(", ")}) — not automatically re-linked.`,
        why:
          "Fields like Task/Event WhoId or WhatId can point at more than one kind of object (a Contact OR " +
          "a Lead; an Account OR an Opportunity OR a Campaign). Bulk API 2.0's external-id relationship " +
          "syntax can't express an either/or lookup, so this platform can't resolve it automatically.",
        action: `${obj.name} records will migrate with their own data, but won't stay linked to their donor/campaign — re-link manually after Load if you need that.`,
      });
    }

    // Multiple record types configured.
    if (obj.recordTypes.length > 1) {
      warnings.push({
        severity: "info",
        kind: "record-types-present",
        object: obj.name,
        message: `${obj.name} has ${obj.recordTypes.length} record types — mapping may need record-type handling.`,
        why: "NPSP and NPC record types are separate configurations in separate orgs — a record type Id copied from NPSP means nothing in NPC.",
        action: "Confirm the target object's record types during Prepare Target, and map RecordTypeId in the Mapping Editor if a specific record type matters here.",
      });
    }
  }

  // Audit kinds that couldn't be captured (honest coverage).
  for (const s of config?.skipped ?? []) {
    warnings.push({
      severity: "info",
      kind: "audit-kind-skipped",
      message: `Org-config audit skipped "${s.kind}": ${s.reason}`,
      why: "Some Salesforce APIs require permissions the connected integration user doesn't have, or aren't exposed the way this platform expects.",
      action: "No action needed unless you specifically rely on this data — it doesn't block migration.",
    });
  }

  const order = { blocker: 0, warn: 1, info: 2 } as const;
  return warnings.sort((a, b) => order[a.severity] - order[b.severity]);
}

// --- Markdown rendering ---

/**
 * Make an arbitrary value safe inside a Markdown table cell. Validation-rule error
 * messages routinely contain newlines and pipes (a real org had bullet lists inside
 * them), which silently terminated the row and corrupted the rest of the table.
 */
function cell(v: string | number): string {
  return String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function table(headers: string[], rows: (string | number)[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n");
  return rows.length ? `${head}\n${sep}\n${body}` : `${head}\n${sep}\n| _none_ |`;
}

/** Render a self-contained Markdown analysis document. Pure. */
export function renderAnalysisMarkdown(r: AnalysisReport): string {
  const out: string[] = [];
  out.push(`# NPSP Org Analysis — ${r.meta.projectName}`);
  out.push(
    `Generated ${r.meta.generatedAt}` +
      (r.meta.analyzedAt ? ` · Analyzed ${r.meta.analyzedAt}` : "") +
      (r.meta.source?.apiVersion ? ` · API v${r.meta.source.apiVersion}` : ""),
  );
  out.push("");

  out.push("## Overview");
  if (r.meta.source) out.push(`- Source org: ${r.meta.source.orgId ?? "?"} (${r.meta.source.instanceUrl})`);
  out.push(`- Objects: ${r.source.objectCount} (${r.source.objectsWithData} with data) · Total records: ${r.source.totalRecords.toLocaleString()}`);
  out.push(`- Mappings: ${r.mappings.drafted} drafted, ${r.mappings.enabled} enabled, ${r.mappings.unmapped} unmapped`);
  const cap = r.meta.capability;
  if (cap) out.push(`- NPSP installed: ${cap.npspInstalled ? "yes" : "no"} · Enhanced Recurring Donations: ${cap.enhancedRecurringDonations ? "yes" : "no"} · Person Accounts: ${cap.personAccountsEnabled ? "yes" : "no"}`);
  out.push("");

  out.push("## Warnings");
  if (r.warnings.length === 0) out.push("_No warnings._");
  else
    for (const w of r.warnings) {
      out.push(`- **[${w.severity}] ${w.message}**`);
      if (w.why) out.push(`  - Why: ${w.why}`);
      if (w.action) out.push(`  - What to do: ${w.action}`);
    }
  out.push("");

  out.push("## Source Object Inventory");
  out.push(
    table(
      ["Object", "Label", "Type", "Records", "Fields", "Record Types"],
      r.source.objects.map((o) => [o.name, o.label, o.custom ? "custom" : "standard", o.count, o.fields.length, o.recordTypes.length]),
    ),
  );
  out.push("");

  out.push("## Field Dictionary");
  for (const o of r.source.objects) {
    out.push(`### ${o.name} (${o.label}) — ${o.count.toLocaleString()} records`);
    out.push(
      table(
        ["Field", "Label", "Type", "Req", "Unique", "Formula", "Picklist / Ref"],
        o.fields.map((f) => [
          f.name,
          f.label,
          f.type,
          f.required ? "Y" : "",
          f.unique ? "Y" : "",
          f.calculated ? "Y" : "",
          f.picklistValues?.length
            ? f.picklistValues.map((p) => p.value).slice(0, 8).join("; ") + (f.picklistValues.length > 8 ? " …" : "")
            : f.referenceTo?.length
              ? `→ ${f.referenceTo.join(", ")}`
              : "",
        ]),
      ),
    );
    out.push("");
  }

  out.push("## Validation Rules & Automations");
  const cfg = r.source.config;
  if (!cfg) out.push("_No config audit captured._");
  else {
    out.push(`### Validation Rules (${cfg.validationRules.length})`);
    out.push(table(["Object", "Rule", "Active", "Error"], cfg.validationRules.map((v) => [v.object, v.name, v.active ? "Y" : "N", v.errorMessage])));
    out.push("");
    out.push(`### Flows (${cfg.flows.length})`);
    out.push(table(["API Name", "Label", "Type", "Trigger Object"], cfg.flows.map((f) => [f.apiName, f.label, f.processType, f.triggerObject ?? ""])));
    out.push("");
    out.push(`### Apex Triggers (${cfg.apexTriggers.length})`);
    out.push(table(["Name", "Object", "Events", "Status"], cfg.apexTriggers.map((t) => [t.name, t.object, t.events.join(", "), t.status])));
    out.push("");
    out.push(`### NPSP TDTM Handlers (${cfg.tdtmHandlers.length})`);
    out.push(table(["Class", "Object", "Trigger", "Active"], cfg.tdtmHandlers.map((t) => [t.className, t.object, t.trigger, t.active ? "Y" : "N"])));
    out.push("");
    out.push(`### Workflow Rules (${cfg.workflowRules.length})`);
    out.push(table(["Object", "Rule"], cfg.workflowRules.map((w) => [w.object, w.name])));
    out.push("");
    out.push(`### Duplicate Rules (${cfg.duplicateRules.length})`);
    // These matter for Load: an active duplicate rule can block inserts on the target.
    out.push(table(["Object", "Rule", "Active"], cfg.duplicateRules.map((d) => [d.object, d.name, d.active ? "Y" : "N"])));
    out.push("");
  }

  out.push("## NPSP Configuration");
  if (!cfg) out.push("_No config audit captured._");
  else {
    // The settings that actually decide how the migration must be performed.
    const c = cfg.npspConfig;
    out.push("### Migration-relevant settings");
    out.push(
      table(
        ["Setting", "Value", "Why it matters"],
        [
          ["Account model", c?.accountModel ?? "unknown", "Decides the Contact/Household → Person Account transform"],
          ["Enhanced Recurring Donations", c?.enhancedRecurringDonations ? "yes (RD2)" : "no (classic RD1)", "RD schedule shape differs between RD1 and RD2"],
          ["Payments enabled", c?.paymentsEnabled === null || c?.paymentsEnabled === undefined ? "unknown" : c.paymentsEnabled ? "yes" : "no", "Whether Opportunity Payments must fold into GiftTransaction"],
          ["Default GAU", c?.defaultGau ?? "—", "Fallback fund for unallocated gifts"],
          ["Household rules", c?.householdRules ?? "—", "Affects household grouping/naming"],
        ],
      ),
    );
    out.push("");
    out.push("### Captured settings objects");
    const settings = cfg.npspSettings ?? {};
    if (Object.keys(settings).length === 0) out.push("_No NPSP custom settings captured._");
    else {
      for (const [obj, rows] of Object.entries(settings)) {
        out.push(`#### ${obj}`);
        // Emit the actual field values — the whole point of reading NPSP settings.
        const first = rows[0] ?? {};
        const entries = Object.entries(first).filter(([, v]) => v !== null && v !== "" && v !== undefined);
        out.push(
          entries.length
            ? table(["Field", "Value"], entries.map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]))
            : "_no populated fields_",
        );
        if (rows.length > 1) out.push(`_(+${rows.length - 1} more row(s))_`);
        out.push("");
      }
    }
  }
  out.push("");

  out.push("## Target Readiness (NPC)");
  out.push(
    `- ${r.targetSummary.total} target objects · ${r.targetSummary.mapped} mapped, ${r.targetSummary.unmapped} unused · ` +
      `${r.targetSummary.issuesEnabled} issue(s) in enabled mappings, ${r.targetSummary.issuesUnreviewed} in unreviewed drafts`,
  );
  out.push("");
  // Only rows a mapping actually claims carry information. UNMAPPED rows are just
  // "this object exists and nothing targets it" — on a real NPC org that is 1,053 of
  // 1,074 rows, which buried the 21 that mattered. Summarize them instead.
  const claimed = r.targetReadiness.filter((t) => t.outcome !== "UNMAPPED");
  const unclaimed = r.targetReadiness.filter((t) => t.outcome === "UNMAPPED");
  out.push(
    table(
      ["Target Object", "Mapped From", "Outcome", "Detail"],
      claimed.map((t) => [
        t.object,
        t.mappedBy.length ? t.mappedBy.map((m) => `${m.source}${m.enabled ? "" : " (disabled)"}`).join(", ") : "—",
        t.outcome,
        !t.exists ? `missing — suggestions: ${t.suggestions.join(", ") || "none"}` : t.missingFields.length ? `missing fields: ${t.missingFields.join(", ")}` : "—",
      ]),
    ),
  );
  out.push("");
  if (unclaimed.length > 0) {
    out.push(
      `<details><summary>${unclaimed.length} further target objects exist but nothing maps to them (UNMAPPED)</summary>`,
    );
    out.push("");
    out.push(unclaimed.map((t) => t.object).join(", "));
    out.push("");
    out.push("</details>");
    out.push("");
  }

  out.push("## Mapping Summary");
  out.push(
    table(
      ["Source", "→ Target", "Confidence", "Fields", "Enabled"],
      r.mappings.rows.map((m) => [m.source, m.target ?? "—", m.confidence, m.fieldCount, m.enabled ? "Y" : ""]),
    ),
  );
  out.push("");

  return out.join("\n");
}
