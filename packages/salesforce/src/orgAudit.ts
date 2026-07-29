import type { Connection } from "jsforce";

/**
 * Org-configuration audit — the "understand the org's automation & rules, not just
 * its data shape" layer of Analyze. Read-only. Everything here is best-effort: each
 * kind is captured in isolation so a locked-down Tooling API, a non-NPSP org, or a
 * workflow-free org never aborts the whole pass — failures land in `skipped`.
 *
 * Uses the Tooling API (SOQL over metadata objects) for validation rules, flows,
 * Apex triggers, workflow & duplicate rules, and plain data SOQL for NPSP's
 * TDTM handlers and Custom Settings. The `api` OAuth scope already covers both, so
 * no re-auth is needed. See docs/sprint_four_planning/01-deep-metadata-capture.md.
 */

export interface ValidationRuleMeta {
  object: string;
  name: string;
  active: boolean;
  errorMessage: string;
  errorDisplayField: string | null;
}
export interface FlowMeta {
  apiName: string;
  label: string;
  processType: string;
  triggerType: string | null;
  triggerObject: string | null;
  status: string;
}
export interface ApexTriggerMeta {
  name: string;
  object: string;
  events: string[];
  status: string;
}
export interface TdtmHandlerMeta {
  className: string;
  object: string;
  trigger: string;
  active: boolean;
  loadOrder: number | null;
}
export interface WorkflowRuleMeta {
  object: string;
  name: string;
}
export interface DuplicateRuleMeta {
  object: string;
  name: string;
  active: boolean;
}

/**
 * The NPSP settings that actually change how a migration must be performed —
 * extracted from the raw custom-settings rows so the report and the operator don't
 * have to read 40+ raw fields. `accountModel` in particular decides the whole
 * constituent transform (Household Accounts vs One-to-One vs Bucket).
 */
export interface NpspConfigSummary {
  /** npe01__Account_Processor__c: "Household Account" | "One-to-One" | "Bucket Account". */
  accountModel: string | null;
  /** True when Enhanced Recurring Donations (RD2) is the live path. */
  enhancedRecurringDonations: boolean;
  /** npe01__Payments_Enabled__c — whether Opportunity Payments are in use. */
  paymentsEnabled: boolean | null;
  /** npsp__Default_GAU__c — the fallback General Accounting Unit, if configured. */
  defaultGau: string | null;
  /** Household naming/rules that affect the household merge. */
  householdRules: string | null;
}

export interface OrgConfigAudit {
  validationRules: ValidationRuleMeta[];
  flows: FlowMeta[];
  apexTriggers: ApexTriggerMeta[];
  /** NPSP's own trigger framework (npsp__Trigger_Handler__c rows). */
  tdtmHandlers: TdtmHandlerMeta[];
  workflowRules: WorkflowRuleMeta[];
  duplicateRules: DuplicateRuleMeta[];
  /** Custom-settings snapshots keyed by settings object api name. */
  npspSettings: Record<string, Record<string, unknown>[]>;
  /** The migration-relevant settings, distilled from `npspSettings`. */
  npspConfig: NpspConfigSummary;
  /** Which kinds were captured successfully (may be empty results). */
  captured: string[];
  /** Kinds that failed to capture, with the reason (e.g. object not exposed). */
  skipped: { kind: string; reason: string }[];
}

type Rec = Record<string, unknown>;

async function toolingRecords(conn: Connection, soql: string): Promise<Rec[]> {
  const res = (await conn.tooling.query(soql)) as unknown as { records?: unknown[] };
  return (res.records ?? []) as Rec[];
}
async function dataRecords(conn: Connection, soql: string): Promise<Rec[]> {
  const res = (await conn.query(soql)) as unknown as { records?: unknown[] };
  return (res.records ?? []) as Rec[];
}

/** Read a possibly-relationship-nested string field, e.g. EntityDefinition.QualifiedApiName. */
function nestedString(rec: Rec, ...path: string[]): string | null {
  let cur: unknown = rec;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Rec)[key];
  }
  return typeof cur === "string" ? cur : null;
}

/** Derive the human trigger-event list from an ApexTrigger's Usage* boolean flags. Pure. */
export function apexTriggerEvents(rec: Rec): string[] {
  const map: [string, string][] = [
    ["UsageBeforeInsert", "before insert"],
    ["UsageAfterInsert", "after insert"],
    ["UsageBeforeUpdate", "before update"],
    ["UsageAfterUpdate", "after update"],
    ["UsageBeforeDelete", "before delete"],
    ["UsageAfterDelete", "after delete"],
    ["UsageAfterUndelete", "after undelete"],
  ];
  return map.filter(([flag]) => rec[flag] === true).map(([, label]) => label);
}

/** Strip jsforce's `attributes` envelope from a queried record. Pure. */
export function stripAttributes(rec: Rec): Rec {
  const { attributes, ...rest } = rec;
  void attributes;
  return rest;
}

/** NPSP package objects that TDTM rows name WITHOUT their `npsp__` prefix. */
const NPSP_UNPREFIXED_OBJECTS = new Set([
  "Address__c",
  "Allocation__c",
  "Partial_Soft_Credit__c",
  "Account_Soft_Credit__c",
  "Engagement_Plan__c",
  "Engagement_Plan_Task__c",
  "Engagement_Plan_Template__c",
  "Level__c",
  "DataImport__c",
  "DataImportBatch__c",
  "General_Accounting_Unit__c",
  "Form_Template__c",
  "Batch__c",
  "Grant_Deadline__c",
  "Trigger_Handler__c",
  "Error__c",
  "Schedulable__c",
  "Fund__c",
]);

/**
 * `npsp__Trigger_Handler__c.npsp__Object__c` stores NPSP's own objects WITHOUT the
 * `npsp__` prefix (`Allocation__c`) while every other section of the analysis uses
 * the fully-qualified name (`npsp__Allocation__c`). Left as-is, any join between the
 * TDTM table and the object inventory silently misses. Pure.
 */
export function normalizeTdtmObjectName(objectName: string): string {
  return NPSP_UNPREFIXED_OBJECTS.has(objectName) ? `npsp__${objectName}` : objectName;
}

/**
 * NPSP configuration lives in hierarchy Custom Settings. These are the ones whose
 * VALUES change how a migration must be performed (account model, RD behaviour,
 * allocation defaults, household naming/relationship auto-create). Each is
 * best-effort — an org missing any of them just skips it.
 */
const NPSP_SETTINGS_OBJECTS = [
  "npe01__Contacts_And_Orgs_Settings__c", // account model + payments enabled — the decisive one
  "npo02__Households_Settings__c", // household rules/naming
  "npe03__Recurring_Donations_Settings__c", // RD period/forecast behaviour
  "npsp__Allocations_Settings__c", // default GAU, payment allocation sync
  "npsp__Household_Naming_Settings__c",
  "npe4__Relationship_Settings__c", // reciprocal/auto-create relationship rules
  "npe5__Affiliations_Settings__c",
  "npsp__Levels_Settings__c",
  "npsp__Customizable_Rollup_Settings__c",
  "npsp__Error_Settings__c",
];

async function fetchValidationRules(conn: Connection): Promise<ValidationRuleMeta[]> {
  const rows = await toolingRecords(
    conn,
    "SELECT ValidationName, Active, ErrorMessage, ErrorDisplayField, EntityDefinition.QualifiedApiName FROM ValidationRule",
  );
  return rows.map((r) => ({
    object: nestedString(r, "EntityDefinition", "QualifiedApiName") ?? "",
    name: String(r.ValidationName ?? ""),
    active: r.Active === true,
    errorMessage: String(r.ErrorMessage ?? ""),
    errorDisplayField: (r.ErrorDisplayField as string) || null,
  }));
}

async function fetchFlows(conn: Connection): Promise<FlowMeta[]> {
  // FlowDefinitionView is a standard Data-API entity (queryable via regular SOQL),
  // NOT a Tooling-API object — querying it through the Tooling API fails with
  // "sObject type 'FlowDefinitionView' is not supported".
  const rows = await dataRecords(
    conn,
    "SELECT ApiName, Label, ProcessType, TriggerType, IsActive, TriggerObjectOrEventLabel FROM FlowDefinitionView WHERE IsActive = true",
  );
  return rows.map((r) => ({
    apiName: String(r.ApiName ?? ""),
    label: String(r.Label ?? r.ApiName ?? ""),
    processType: String(r.ProcessType ?? ""),
    triggerType: (r.TriggerType as string) || null,
    triggerObject: (r.TriggerObjectOrEventLabel as string) || null,
    status: r.IsActive === true ? "Active" : "Inactive",
  }));
}

async function fetchApexTriggers(conn: Connection): Promise<ApexTriggerMeta[]> {
  const rows = await toolingRecords(
    conn,
    "SELECT Name, TableEnumOrId, Status, UsageBeforeInsert, UsageAfterInsert, UsageBeforeUpdate, UsageAfterUpdate, UsageBeforeDelete, UsageAfterDelete, UsageAfterUndelete FROM ApexTrigger",
  );
  return rows.map((r) => ({
    name: String(r.Name ?? ""),
    object: String(r.TableEnumOrId ?? ""),
    events: apexTriggerEvents(r),
    status: String(r.Status ?? ""),
  }));
}

async function fetchTdtmHandlers(conn: Connection): Promise<TdtmHandlerMeta[]> {
  const rows = await dataRecords(
    conn,
    "SELECT npsp__Class__c, npsp__Object__c, npsp__Trigger_Action__c, npsp__Active__c, npsp__Load_Order__c FROM npsp__Trigger_Handler__c",
  );
  return rows.map((r) => ({
    className: String(r.npsp__Class__c ?? ""),
    object: normalizeTdtmObjectName(String(r.npsp__Object__c ?? "")),
    trigger: String(r.npsp__Trigger_Action__c ?? ""),
    active: r.npsp__Active__c === true,
    loadOrder: typeof r.npsp__Load_Order__c === "number" ? r.npsp__Load_Order__c : null,
  }));
}

async function fetchWorkflowRules(conn: Connection): Promise<WorkflowRuleMeta[]> {
  const rows = await toolingRecords(conn, "SELECT Name, TableEnumOrId FROM WorkflowRule");
  return rows
    .map((r) => ({ object: String(r.TableEnumOrId ?? ""), name: String(r.Name ?? "") }))
    .sort((a, b) => a.object.localeCompare(b.object) || a.name.localeCompare(b.name));
}

async function fetchDuplicateRules(conn: Connection): Promise<DuplicateRuleMeta[]> {
  // DuplicateRule is a standard Data-API object (regular SOQL), not a Tooling object.
  const rows = await dataRecords(conn, "SELECT DeveloperName, SobjectType, IsActive FROM DuplicateRule");
  return rows.map((r) => ({
    object: String(r.SobjectType ?? ""),
    name: String(r.DeveloperName ?? ""),
    active: r.IsActive === true,
  }));
}

/** First non-empty value of `field` across a settings object's rows. Pure. */
function settingValue(settings: Record<string, Rec[]>, object: string, field: string): unknown {
  for (const row of settings[object] ?? []) {
    const v = row[field];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/**
 * Distil the migration-relevant NPSP settings out of the raw custom-settings rows.
 * Pure and unit-testable. `enhancedRd` is passed in because RD2 is best detected
 * from the live TDTM handler registrations, not from a settings flag alone.
 */
export function summarizeNpspConfig(
  settings: Record<string, Rec[]>,
  tdtmHandlers: readonly TdtmHandlerMeta[] = [],
): NpspConfigSummary {
  const accountModel = settingValue(settings, "npe01__Contacts_And_Orgs_Settings__c", "npe01__Account_Processor__c");
  const paymentsEnabled = settingValue(settings, "npe01__Contacts_And_Orgs_Settings__c", "npe01__Payments_Enabled__c");
  const defaultGau = settingValue(settings, "npsp__Allocations_Settings__c", "npsp__Default__c");
  const householdRules = settingValue(settings, "npo02__Households_Settings__c", "npo02__Household_Rules__c");
  // NPSP registers RD2_* handlers only when Enhanced Recurring Donations is in play.
  const enhancedRecurringDonations = tdtmHandlers.some(
    (h) => h.className.startsWith("RD2_") && h.active,
  );
  return {
    accountModel: typeof accountModel === "string" ? accountModel : null,
    enhancedRecurringDonations,
    paymentsEnabled: typeof paymentsEnabled === "boolean" ? paymentsEnabled : null,
    defaultGau: typeof defaultGau === "string" ? defaultGau : null,
    householdRules: typeof householdRules === "string" ? householdRules : null,
  };
}

async function fetchNpspSettings(conn: Connection): Promise<Record<string, Rec[]>> {
  const out: Record<string, Rec[]> = {};
  for (const obj of NPSP_SETTINGS_OBJECTS) {
    try {
      // Hierarchy custom settings have few rows (org-default + overrides). FIELDS(ALL)
      // pulls custom fields too; the required LIMIT is well above the row count.
      const rows = await dataRecords(conn, `SELECT FIELDS(ALL) FROM ${obj} LIMIT 200`);
      if (rows.length) out[obj] = rows.map(stripAttributes);
    } catch {
      // object not present (NPSP feature not installed) — skip this settings object.
    }
  }
  return out;
}

/**
 * Capture the full read-only configuration audit for one org. Each kind is isolated:
 * a failure records `{ kind, reason }` in `skipped` and never aborts the others.
 */
export async function captureOrgConfigAudit(conn: Connection): Promise<OrgConfigAudit> {
  const audit: OrgConfigAudit = {
    validationRules: [],
    flows: [],
    apexTriggers: [],
    tdtmHandlers: [],
    workflowRules: [],
    duplicateRules: [],
    npspSettings: {},
    npspConfig: {
      accountModel: null,
      enhancedRecurringDonations: false,
      paymentsEnabled: null,
      defaultGau: null,
      householdRules: null,
    },
    captured: [],
    skipped: [],
  };

  const runners: { kind: string; run: () => Promise<void> }[] = [
    { kind: "validationRules", run: async () => void (audit.validationRules = await fetchValidationRules(conn)) },
    { kind: "flows", run: async () => void (audit.flows = await fetchFlows(conn)) },
    { kind: "apexTriggers", run: async () => void (audit.apexTriggers = await fetchApexTriggers(conn)) },
    { kind: "tdtmHandlers", run: async () => void (audit.tdtmHandlers = await fetchTdtmHandlers(conn)) },
    { kind: "workflowRules", run: async () => void (audit.workflowRules = await fetchWorkflowRules(conn)) },
    { kind: "duplicateRules", run: async () => void (audit.duplicateRules = await fetchDuplicateRules(conn)) },
    { kind: "npspSettings", run: async () => void (audit.npspSettings = await fetchNpspSettings(conn)) },
  ];

  await Promise.all(
    runners.map(async ({ kind, run }) => {
      try {
        await run();
        audit.captured.push(kind);
      } catch (e) {
        audit.skipped.push({ kind, reason: (e as Error).message });
      }
    }),
  );
  // Derived last: needs both the settings rows and the TDTM registrations, and both
  // are best-effort, so this degrades to defaults rather than failing the audit.
  audit.npspConfig = summarizeNpspConfig(audit.npspSettings, audit.tdtmHandlers);

  audit.captured.sort();
  audit.skipped.sort((a, b) => a.kind.localeCompare(b.kind));
  return audit;
}
