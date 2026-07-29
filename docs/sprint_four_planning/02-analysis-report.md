# 02 · The NPSP Analysis Report

[← Deep Metadata Capture](01-deep-metadata-capture.md) · [Index](README.md) · Next: [Target Readiness →](03-target-readiness.md)

---

The report is the operator-facing deliverable of the Analyze stage: a **complete, readable picture of
the NPSP org** they can review before mapping/transforming, and archive/share as a document.

Three pieces: a **builder** (assembles the report from captured data — no live org calls), an **API**
(`/analysis` with `format=json|md`), and a **web page** (renders it, with download buttons).

---

## 1. The report data structure

Built entirely from data captured at Analyze — `object_run.checkpoint` (widened inventory),
`stage_run.audit` (config audit), `mapping_definition` (drafts), and `org_connection` (org identity +
capability probe). **No Salesforce calls at report time** — it's a pure projection of the DB, so it's
fast and works offline after Analyze.

```ts
interface AnalysisReport {
  meta: {
    projectName: string;
    generatedAt: string;
    analyzedAt: string | null;          // stage_run.finishedAt
    source: { orgId: string; instanceUrl: string; apiVersion: string; username?: string } | null;
    target: { orgId: string; instanceUrl: string; apiVersion: string } | null;
    capability?: CapabilityReport;       // from org_connection.tokenMeta (Connect-time probe)
  };
  source: {
    objectCount: number;
    objectsWithData: number;
    totalRecords: number;
    objects: ReportObject[];             // full inventory, sorted by record count desc
    config: OrgConfigAudit | null;       // validation rules, flows, triggers, TDTM, NPSP settings
  };
  targetReadiness: {
    object: string; exists: boolean; missingFields: string[]; suggestions: string[];
    outcome: "PASS" | "WARN" | "MISSING";
  }[];
  mappings: {
    drafted: number; enabled: number; unmapped: number;
    rows: { source: string; target: string | null; confidence: string; fieldCount: number; enabled: boolean }[];
  };
  warnings: Warning[];                   // derived cross-checks (see §4)
}

interface ReportObject {
  name: string; label: string; custom: boolean; count: number;
  fields: FieldMeta[];                   // the widened dictionary
  recordTypes: RecordTypeMeta[];
  childRelationships: ChildRelationshipMeta[];
  lookups: { field: string; referenceTo: string[] }[];   // derived from fields (reference type)
}

interface Warning {
  severity: "info" | "warn" | "blocker";
  kind: string;                          // e.g. "unmapped-object-with-data", "unmapped-required-target-field"
  object?: string;
  message: string;
}
```

---

## 2. The API — `GET /projects/:id/analysis`

New file `apps/api/src/routes/analysis.ts` (auth + `getOwnedProject`, mirroring `mappings.ts` /
`stages.ts`). Registered in `server.ts` after `mappingRoutes`.

- `GET /projects/:id/analysis` → structured `AnalysisReport` JSON (for the UI).
- `GET /projects/:id/analysis?format=json` → same JSON but as a **download**
  (`Content-Disposition: attachment; filename="npsp-analysis-<id>.json"`).
- `GET /projects/:id/analysis?format=md` → **Markdown** document (`text/markdown` attachment).

Behavior:
- Load the latest `analyze` `StageRun` (with `objectRuns` + `audit`). If none → `400 "run Analyze
  first"` (same pattern as the Validate `/report`, `stages.ts:206`).
- Reunite the **full** `checkpoint.fields` here (this endpoint does **not** strip them — unlike
  `GET /stages/analyze` which keeps a lightweight payload). This is the one place the rich data is
  surfaced.
- Build the structure with a pure helper `buildAnalysisReport(stageRun, mappings, connections)` (unit
  testable, no I/O), then either return JSON or render Markdown via `renderAnalysisMarkdown(report)`.

### 2.1 Markdown rendering

`renderAnalysisMarkdown(report): string` — a pure function producing a self-contained `.md`:

```
# NPSP Org Analysis — <projectName>
Generated <generatedAt> · Analyzed <analyzedAt> · API v<apiVersion>

## Overview
- Source org: <orgId> (<instanceUrl>)
- Objects: <objectCount> (<objectsWithData> with data) · Total records: <totalRecords>
- Mappings: <drafted> drafted, <enabled> enabled, <unmapped> unmapped
- NPSP installed: yes/no · Enhanced Recurring Donations: yes/no · ...

## Warnings
- [blocker] Designation target object missing in NPC — ...
- [warn]  npe03__Recurring_Donation__c has 1,240 records but is unmapped
- ...

## Source Object Inventory
| Object | Label | Type | Records | Fields | Record Types |
|--------|-------|------|--------:|-------:|-------------:|
| ...

## Field Dictionary
### Account (Account) — 3,201 records
| Field | Label | Type | Req | Unique | Formula | Picklist / Ref |
|-------|-------|------|:---:|:------:|:-------:|----------------|
| ...
(one section per object, custom fields first)

## Relationships
(lookup graph: object.field → referenceTo[])

## Validation Rules & Automations
(validation rules, flows, Apex triggers, NPSP TDTM handlers, workflow & duplicate rules)

## NPSP Configuration
(recurring-donation settings, allocations settings, contacts-and-orgs settings, ...)

## Target Readiness (NPC)
| Target Object | Outcome | Missing Fields / Suggestions |
| ...

## Mapping Summary
| Source | → Target | Confidence | Fields | Enabled |
| ...
```

Keep it pure (string in → string out) so it's covered by a unit test with a fixture report.

---

## 3. The web report page

New: `apps/web/app/projects/[id]/analysis/page.tsx` — `useSession`-guarded, reuses `card`/`btn`/`input`
and the confidence-pill/outcome-pill patterns already in the project page.

Layout (single scrollable page with a sticky section nav):

1. **Overview** — org identity, counts, capability booleans, and the Download buttons
   (**Markdown**, **JSON**).
2. **Warnings** — severity-colored list (blocker/warn/info).
3. **Source Object Inventory** — sortable table (Object, Label, Type, Records, Fields, Record Types);
   filter box; each row expands to…
4. **Field Dictionary** (per object, lazy-rendered on expand) — the widened columns (Req, Unique,
   Formula, Picklist values, Reference-to). This is the "proper understanding" surface.
5. **Relationships** — lookups out (`field → referenceTo`) and child relationships in.
6. **Validation Rules & Automations** — grouped tables from the config audit; a note listing any
   `skipped` audit kinds and why.
7. **NPSP Configuration** — key/value cards for each captured custom-settings object.
8. **Target Readiness** — the NPC conformance table (PASS/WARN/MISSING + suggestions).
9. **Mapping Summary** — draft/enabled/unmapped counts + per-object table, each linking to the
   **Mapping Editor** (`/projects/[id]/mappings`) so review flows straight from the report.

Data fetch: `apiGet<AnalysisReport>('/projects/:id/analysis')`. Downloads: anchor tags to
`${API_BASE}/projects/:id/analysis?format=md` / `?format=json` with the session cookie
(`credentials:"include"` — for downloads use a normal `<a href>` since the cookie is sent
automatically on same-site navigation; if cross-origin cookie issues arise, add a small
`apiGetBlob` helper in `lib/api.ts` that fetches with `credentials:"include"` and triggers a
client-side download).

---

## 4. Derived warnings (the "help the operator" layer)

Computed in `buildAnalysisReport` by cross-referencing inventory × mappings × audit × target
readiness. This is what turns raw metadata into *guidance*:

| Warning kind | Severity | Rule |
|---|---|---|
| `unmapped-object-with-data` | warn | source object has `count > 0` but its mapping `target` is null |
| `target-object-missing` | blocker | an **enabled** mapping's target object doesn't exist in NPC |
| `unmapped-required-target-field` | warn | a required field on an enabled mapping's target object has no source field mapped to it (needs the widened `required` flag) |
| `large-object` | info | `count` above a threshold (e.g. 100k) — flags Bulk/PK-chunking attention |
| `polymorphic-lookup-present` | info | source object has a reference field with >1 `referenceTo` (e.g. `WhoId`) — not re-linked by v1 |
| `npsp-feature-manual` | info | capability probe shows a feature (e.g. Enhanced Recurring Donations) that has no structural transform |
| `record-types-present` | info | object has >1 active record type — mapping may need record-type handling |
| `audit-kind-skipped` | info | a config-audit kind failed to capture (surfaces honesty about coverage) |

Warnings appear both in the UI and the Markdown, sorted blocker → warn → info.

---

## 5. Why not reuse the existing `/report`?

`GET /projects/:id/report` (`stages.ts:194-268`) is the **post-migration reconciliation** report,
built exclusively from the **Validate** stage. It answers "did the migration reconcile?" — a different
question, a different stage, a different lifecycle. Keep it as-is; `/analysis` is the **pre-migration
understanding** report built from **Analyze**. Two reports, two purposes.
