# 00 · Overview & Assessment

[Index](README.md) · Next: [Deep Metadata Capture →](01-deep-metadata-capture.md)

---

## 1. What you asked for

> Connect the **source NPSP** org and a **fresh, blank target NPC** org → **analyze the NPSP org
> properly, with full metadata**, so we have a real understanding of its schema → **produce proper
> docs / an analysis report** on the NPSP org for the operator's reference → *then* move on to
> matching, transforming, and migrating into the NPC org.

The pipeline that does the *moving* of data already exists and works. What's thin is the **first
half**: the *understanding* and the *report*. Sprint 4 makes the Analyze stage live up to its name.

---

## 2. Honest assessment: is the current system good?

**Yes — keep the foundation.** This is a deepening, not a rebuild. Evidence from the codebase:

### What is genuinely good (do not touch)
- **Durable state machine.** `StageRun` (one row per stage attempt, status *derived* from children)
  + `ObjectRun` (per-object granularity) give real restartability.
  `packages/core/src/state-machine.ts` (`canStartStage`, `deriveStageStatus`), review gates enforced
  in `apps/api/src/routes/stages.ts`.
- **Idempotent, re-runnable loads.** `Legacy_NPSP_Id__c` external-id + Bulk 2.0 `upsert` means
  re-running Load never duplicates. `packages/salesforce/src/bulk2.ts`, `metadata.ts`.
- **General-purpose discovery (no hardcoded object limit).** `discoverSourceObjects` /
  `discoverAllObjects` ask each org what it actually has.
  `packages/salesforce/src/discovery.ts:107-134`.
- **DB-backed dynamic mapping layer + Mapping Editor** (Sprints 2–3): `mapping_definition` rows
  auto-drafted at Analyze, review-gated, editable in the UI.

### The three real gaps

**Gap 1 — the analysis is shallow.** `buildInventory` calls `conn.describe(s.name)` — which returns
jsforce's *full* `Field` object (picklist values, `nillable`, `unique`, `calculatedFormula`,
`controllerName`, `recordTypeInfos`, `childRelationships`, …) — then **throws it all away**:

```ts
// packages/salesforce/src/discovery.ts:84-91  (current)
d.fields.map((f) => ({
  name: f.name, label: f.label, type: f.type, custom: f.custom,
  referenceTo: f.referenceTo?.length ? f.referenceTo : undefined,
  relationshipName: f.relationshipName ?? null,
}))
```

Everything else is discarded. Deeper configuration — validation rules, flows, Apex/TDTM triggers,
workflow & duplicate rules, NPSP Custom Settings — is **never fetched at all** (the Tooling API is
unused across the whole repo; the Metadata API is used only to *write* one external-id field).

**Gap 2 — there is no analysis report.** The Analyze API deliberately strips the field metadata down
to a single integer before the browser ever sees it:

```ts
// apps/api/src/routes/stages.ts:109-118  (current)
if (stage === "analyze") {
  return { ...stageRun, objectRuns: stageRun.objectRuns.map((o) => {
    const { fields, ...rest } = (o.checkpoint ?? {}) as Record<string, unknown>;
    const fieldCount = Array.isArray(fields) ? fields.length : undefined;
    return { ...o, checkpoint: { ...rest, fieldCount } };
  }) };
}
```

The UI (`AnalyzePanel`, `apps/web/app/projects/[id]/page.tsx`) then renders **status + counts +
three tables** whose deepest schema detail is a field *count*. There is no field dictionary, no
relationship view, no NPSP-config summary, nothing downloadable. The only report artifact in the
whole product is the post-migration reconciliation CSV from Validate
(`stages.ts:194-268`).

**Gap 3 — re-running Analyze wipes mapping edits.** Analyze re-seeds by deleting *everything*:

```ts
// apps/worker/src/jobs/analyze.ts:108  (current)
await prisma.mappingDefinition.deleteMany({ where: { projectId } });
```

So if the operator curates mappings in the editor and then re-runs Analyze (e.g. after connecting the
target, or to pick up schema changes), **all hand edits are silently discarded**. The `version` /
`approvedBy` / `approvedAt` columns that exist for exactly this are unused.

---

## 3. Scope of Sprint 4

**In scope**
- **A. Deep metadata capture** — widen field metadata (free win) + a new Tooling/Metadata
  **org-config audit** (validation rules, flows, triggers/TDTM, workflow, duplicate rules, NPSP
  settings). → [01](01-deep-metadata-capture.md)
- **B. The NPSP Analysis Report** — a structured `/analysis` API, a rendered report page, and
  Markdown + JSON download. → [02](02-analysis-report.md)
- **C. Target readiness check** — light NPC conformance (mapped objects/fields exist), surfaced in
  the report. → [03](03-target-readiness.md)
- **D. Preserve curation** on re-Analyze + **E. type/picklist-aware** draft suggestions.
  → [04](04-curation-and-suggestions.md)

**Out of scope (deferred, deliberately)**
- Pipeline hardening: load-order graph, polymorphic lookups (Task/Event `WhoId`/`WhatId`), FLS grant
  after field creation, O(n²) OFFSET pagination, partial-parent orphan risk. (Real issues — a Sprint
  5 candidate; listed in [06](06-verification.md) §"Known deferred").
- **Deep target audit** — the NPC org is blank/standard; a readiness check is enough.
- **Structural transforms** (household→Person-Account merge, Opportunity+Payment consolidation, soft
  credits, RecurringDonation→GiftCommitment). Still out of scope.
- **Migrating NPSP automations/validation rules into NPC.** The audit is **advisory** — it documents
  what exists so the operator can decide what to recreate; the platform does not port config.

---

## 4. Success criteria

The sprint is done when:

1. After Analyze, `object_run.checkpoint` holds **widened** per-field metadata (required, unique,
   picklist values, formula, controlling field, …) plus record types and child relationships; and
   `stage_run.audit` holds the **org-config audit** for the source org.
2. `GET /projects/:id/analysis` returns a complete structured report; `?format=md` and `?format=json`
   download the document; the **report page renders** every section (inventory, field dictionary,
   relationships, record types, validation rules & automations, NPSP config, target readiness,
   mapping summary, warnings).
3. Editing a mapping and then **re-running Analyze preserves the edit** (curation survives); untouched
   auto-drafts still refresh.
4. Draft suggestions use picklist values (value-map hints) and flag **unmapped required target
   fields**.
5. `pnpm -r run typecheck` and `pnpm -r run test` are green (new `draft`/`orgAudit` unit tests
   included).

See [06-verification.md](06-verification.md) for the exact test procedure.
