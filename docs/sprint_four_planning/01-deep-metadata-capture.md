# 01 · Deep Metadata Capture

[← Overview](00-overview-and-assessment.md) · [Index](README.md) · Next: [Analysis Report →](02-analysis-report.md)

---

Two layers of capture, both read-only:

1. **Schema depth** — stop discarding the rich `describe()` data we already fetch. *No new API calls.*
2. **Org configuration audit** — new Tooling/Metadata API reads for validation rules, flows,
   triggers, workflow/duplicate rules, and NPSP settings.

---

## 1. Schema depth (the "free win")

### 1.1 Widen `FieldMeta`

`packages/salesforce/src/discovery.ts:16-24` — extend the interface. Every added property is already
present on jsforce's `Field` object returned by `conn.describe()`; we're just keeping it.

```ts
export interface FieldMeta {
  name: string;
  label: string;
  type: string;                 // "string" | "picklist" | "reference" | "currency" | ...
  custom: boolean;
  // --- newly retained (all already on the describe() Field) ---
  required: boolean;            // = !nillable && !defaultedOnCreate  (see note)
  unique: boolean;
  externalId: boolean;
  length?: number;              // text length
  precision?: number;           // number precision
  scale?: number;               // number scale
  calculated: boolean;          // formula/roll-up
  calculatedFormula?: string | null;
  controllerName?: string | null;   // controlling field for dependent picklists
  dependentPicklist?: boolean;
  inlineHelpText?: string | null;
  picklistValues?: { value: string; label: string; active: boolean; default: boolean }[];
  // --- already retained ---
  referenceTo?: string[];
  relationshipName?: string | null;
}
```

> **`required` note:** a field is effectively required if `!f.nillable` and it isn't auto-defaulted.
> jsforce exposes `nillable` and `defaultedOnCreate`. Use
> `required: !f.nillable && !f.defaultedOnCreate` — good enough for the report; document the caveat.

### 1.2 Capture object-level metadata

`describe()` also returns `recordTypeInfos` and `childRelationships`. Add them to the object shape
(`DiscoveredSourceObject`, `discovery.ts:26-35`):

```ts
export interface RecordTypeMeta { recordTypeId: string; name: string; developerName: string; active: boolean; master: boolean; }
export interface ChildRelationshipMeta { childSObject: string; field: string; relationshipName: string | null; cascadeDelete: boolean; }

export interface DiscoveredSourceObject {
  name: string; label: string; custom: boolean; count: number;
  fields: FieldMeta[];
  recordTypes: RecordTypeMeta[];         // NEW
  childRelationships: ChildRelationshipMeta[];  // NEW
}
```

### 1.3 Map it in `buildInventory`

`discovery.ts:81-95` — widen the `describe()` mapping (still one describe call per object):

```ts
conn.describe(s.name).then((d): Omit<DiscoveredSourceObject, "name"|"label"|"custom"|"count"> => ({
  fields: d.fields.map((f) => ({
    name: f.name, label: f.label, type: f.type, custom: f.custom,
    required: !f.nillable && !f.defaultedOnCreate,
    unique: !!f.unique,
    externalId: !!f.externalId,
    length: f.length || undefined,
    precision: f.precision || undefined,
    scale: f.scale ?? undefined,
    calculated: !!f.calculated,
    calculatedFormula: f.calculatedFormula ?? null,
    controllerName: f.controllerName ?? null,
    dependentPicklist: !!f.dependentPicklist,
    inlineHelpText: f.inlineHelpText ?? null,
    picklistValues: f.picklistValues?.length
      ? f.picklistValues.map((p) => ({ value: p.value, label: p.label ?? p.value, active: !!p.active, default: !!p.defaultValue }))
      : undefined,
    referenceTo: f.referenceTo?.length ? f.referenceTo : undefined,
    relationshipName: f.relationshipName ?? null,
  })),
  recordTypes: (d.recordTypeInfos ?? []).map((rt) => ({
    recordTypeId: rt.recordTypeId, name: rt.name, developerName: rt.developerName,
    active: !!rt.active, master: !!rt.master,
  })),
  childRelationships: (d.childRelationships ?? []).map((c) => ({
    childSObject: c.childSObject, field: c.field,
    relationshipName: c.relationshipName ?? null, cascadeDelete: !!c.cascadeDelete,
  })),
}))
```

> This flows straight into `object_run.checkpoint` in `analyze.ts` (§4) — **no Prisma change** for
> the schema-depth layer, because `checkpoint` is already `Json`.

---

## 2. Org-configuration audit (new Tooling/Metadata reads)

### 2.1 Why these APIs are available with zero re-auth

The OAuth scopes already requested include `api` (`packages/salesforce/src/auth.ts:31`), which covers
**both** the Tooling API and the Metadata API. The jsforce `Connection` we build
(`connection.ts:21-32`) exposes `conn.tooling.query(...)` and `conn.metadata.read/list(...)`
out-of-the-box. **No scope change, no re-auth.** Today only `conn.metadata.create/read` of one
`CustomField` is used (`metadata.ts`); the Tooling API is entirely unused.

### 2.2 New file: `packages/salesforce/src/orgAudit.ts`

A single entry point that gathers the config audit, each kind **best-effort** (one failing kind must
not fail the pass), with bounded concurrency. Shape:

```ts
export interface OrgConfigAudit {
  validationRules: { object: string; name: string; active: boolean; errorMessage: string; errorDisplayField: string | null }[];
  flows: { apiName: string; label: string; processType: string; triggerType: string | null; triggerObject: string | null; status: string }[];
  apexTriggers: { name: string; object: string; events: string[]; status: string }[];
  tdtmHandlers: { className: string; object: string; trigger: string; active: boolean; loadOrder: number | null }[]; // npsp__Trigger_Handler__c
  workflowRules: { object: string; name: string; active: boolean }[];
  duplicateRules: { object: string; name: string; active: boolean }[];
  npspSettings: Record<string, Record<string, unknown>>; // custom-settings snapshots keyed by object
  captured: string[];   // which kinds succeeded
  skipped: { kind: string; reason: string }[];
}

export async function captureOrgConfigAudit(conn: Connection): Promise<OrgConfigAudit>;
```

### 2.3 How each kind is fetched

All read-only. Prefer the **Tooling API** (SOQL over metadata objects) — it's simpler than Metadata
API `list`/`read` round-trips.

| Kind | Source | Query (sketch) |
|---|---|---|
| Validation rules | Tooling | `SELECT ValidationName, Active, ErrorMessage, ErrorDisplayField, EntityDefinition.QualifiedApiName FROM ValidationRule` |
| Flows | Tooling | `SELECT ApiName, Label, ProcessType, TriggerType, TriggerObjectOrEvent.QualifiedApiName, ... FROM FlowDefinitionView WHERE IsActive = true` (fallback: `FlowDefinition`) |
| Apex triggers | Tooling | `SELECT Name, TableEnumOrId, UsageBeforeInsert, UsageAfterInsert, ..., Status FROM ApexTrigger` → derive object + event list |
| NPSP TDTM handlers | **SOQL** (data) | `SELECT npsp__Class__c, npsp__Object__c, npsp__Trigger_Action__c, npsp__Active__c, npsp__Load_Order__c FROM npsp__Trigger_Handler__c` |
| Workflow rules | Tooling | `SELECT Name, TableEnumOrId FROM WorkflowRule` (Active via Metadata if needed) |
| Duplicate rules | Tooling | `SELECT DeveloperName, SobjectType, IsActive FROM DuplicateRule` |
| NPSP settings | **SOQL** (data) | `SELECT ... FROM npe03__Recurring_Donations_Settings__c` / `npsp__Allocations_Settings__c` / `npe01__Contacts_And_Orgs_Settings__c` / `npo02__Households_Settings__c` (hierarchy custom settings — read the org-default row) |

Implementation notes:
- Wrap each kind in `try/catch`; on failure push `{ kind, reason }` to `skipped` and continue. Orgs
  differ (a workflow-free org, no NPSP, Tooling object not exposed) — none should abort the audit.
- Bound concurrency (reuse the `mapWithConcurrency` helper already in `discovery.ts`, or keep a small
  local copy) so we don't fan out dozens of Tooling queries at once.
- Group per-object kinds (validation rules, triggers) by object name for the report; keep global
  kinds (screen/autolaunched flows, duplicate rules) in flat lists.
- Tooling query result typing: `conn.tooling.query<T>(soql)` returns `{ records: T[] }`.

Export everything from `packages/salesforce/src/index.ts`.

---

## 3. Data model change (minimal — one nullable column)

The **describe()-derived** inventory (widened fields, record types, child relationships) rides in the
existing `object_run.checkpoint` — no schema change.

The **config audit** is org-scoped (not neatly per-`object_run`), so store it once per Analyze run.
Add **one nullable column** to `StageRun`:

```prisma
// packages/db/prisma/schema.prisma  (model StageRun, ~line 140)
model StageRun {
  // ...existing fields...
  stats  Json?
  audit  Json?   // NEW: { source: OrgConfigAudit, target?: OrgConfigAudit }
  // ...
}
```

> **You run:** `pnpm db:push` (adds a nullable column — no data loss). I won't touch your DB.

Why a column and not a new table: it's written once and read once (by the report), it's a few hundred
KB of JSON at most, and it avoids new indexes/relations. If the audit ever needs to be queried
relationally, promoting it to an `AnalysisArtifact` table is a clean later refactor.

---

## 4. Wiring into Analyze

In `apps/worker/src/jobs/analyze.ts`:

- **Source object_runs** already store `checkpoint: { label, custom, fields }`. Add the new fields:
  `checkpoint: { label, custom, fields: o.fields, recordTypes: o.recordTypes, childRelationships: o.childRelationships }`.
- **After** source discovery (source conn is in hand), capture the audit:
  ```ts
  let sourceAudit: OrgConfigAudit | undefined;
  try { sourceAudit = await captureOrgConfigAudit(sourceConn); }
  catch (e) { console.warn(`[worker] analyze: source config audit skipped: ${(e as Error).message}`); }
  ```
- Persist it in the final `stageRun.update`: `data: { status, finishedAt, stats, audit: { source: sourceAudit } as Prisma.InputJsonValue }`.
- **Target** stays a readiness check ([03](03-target-readiness.md)) — do **not** run
  `captureOrgConfigAudit` on the blank NPC org.

Exact diffs are in [05-implementation-steps.md](05-implementation-steps.md).

---

## 5. Cost & safety

- **Schema depth:** zero extra API calls (same `describe()`), slightly larger `checkpoint` JSON.
- **Config audit:** a handful of Tooling/SOQL queries per Analyze run (not per object) — cheap
  relative to the existing per-object `describe()`+`COUNT()` fan-out. All read-only; the source org is
  never written. Every kind degrades gracefully to `skipped`.
