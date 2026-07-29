# 05 · Implementation Steps (build order + code)

[← Curation & Suggestions](04-curation-and-suggestions.md) · [Index](README.md) · Next: [Verification →](06-verification.md)

---

Ordered so the tree typechecks after each step. Each step notes **who runs what** — the code changes
are mine; `pnpm db:push` and restarting worker/web are yours (local setup).

> Working conventions confirmed from the repo: pnpm workspaces; cross-platform test runner
> `scripts/test.mjs`; regenerate the Prisma client explicitly after schema edits
> (`pnpm --filter @opennpc/db run generate`) to avoid the postinstall stub race.

---

## Step 1 — Widen field + object metadata (`packages/salesforce`)

**Files:** `discovery.ts` (interfaces `FieldMeta`, `DiscoveredSourceObject`, mapping in
`buildInventory`), export any new types from `index.ts`.

- Add the new `FieldMeta` properties and the `RecordTypeMeta` / `ChildRelationshipMeta` interfaces
  ([01](01-deep-metadata-capture.md) §1.1–1.2).
- Update the `conn.describe()` mapping in `buildInventory` (`discovery.ts:81-95`) to keep the rich
  data + record types + child relationships ([01](01-deep-metadata-capture.md) §1.3).
- `summarizeFields`, `discoverTargetSchema`, `findSimilarObjectNames` are unaffected (they read only
  `name`/`custom`).

**Verify:** `pnpm --filter @opennpc/salesforce run typecheck`.

---

## Step 2 — Org-config audit (`packages/salesforce/src/orgAudit.ts`, new)

- Create `orgAudit.ts` with `OrgConfigAudit` + `captureOrgConfigAudit(conn)`
  ([01](01-deep-metadata-capture.md) §2). Each kind best-effort in its own `try/catch`; bounded
  concurrency; group per-object kinds by object.
- Use `conn.tooling.query<T>(soql)` for validation rules, flows, Apex triggers, workflow, duplicate
  rules; use plain `conn.query` for `npsp__Trigger_Handler__c` and the NPSP custom-settings objects.
- Export from `index.ts`.
- **Unit test** the pure grouping/parse helpers (e.g. deriving trigger events from `ApexTrigger`
  `UsageBefore/After*` flags, grouping validation rules by object) in `orgAudit.test.ts` with fixture
  Tooling records — no live org.

**Verify:** `pnpm --filter @opennpc/salesforce run typecheck && pnpm --filter @opennpc/salesforce run test`.

---

## Step 3 — Schema: `StageRun.audit` (`packages/db`)

- Add `audit Json?` to `model StageRun` in `schema.prisma`
  ([01](01-deep-metadata-capture.md) §3).
- **You run:** `pnpm db:push` then I run `pnpm --filter @opennpc/db run generate` (or you run both).

**Verify:** `pnpm --filter @opennpc/db run typecheck`.

---

## Step 4 — Capture in Analyze (`apps/worker`)

**File:** `apps/worker/src/jobs/analyze.ts`.

- Source `object_run` checkpoints: add `recordTypes` + `childRelationships`
  ([01](01-deep-metadata-capture.md) §4).
- After source discovery, `captureOrgConfigAudit(sourceConn)` (best-effort) → hold as `sourceAudit`.
- Pass `required` + `picklistValues` into the draft input (stop narrowing at `analyze.ts:97,102`)
  ([04](04-curation-and-suggestions.md) §E.1).
- **Preserve curation:** replace the blanket `mappingDefinition.deleteMany` with the
  load-protected → delete-auto-drafted → recreate flow ([04](04-curation-and-suggestions.md) §D.2).
- Final `stageRun.update`: add `audit: { source: sourceAudit }`.

**Verify:** `pnpm --filter @opennpc/worker run typecheck`.

---

## Step 5 — Smarter drafts (`packages/mapping`)

**Files:** `draft.ts` (+ `draft.test.ts`).

- Widen `DraftFieldMeta` with optional `required` / `picklistValues`
  ([04](04-curation-and-suggestions.md) §E.1).
- Picklist→picklist `valueMap` suggestions + `unmetRequired` computation
  ([04](04-curation-and-suggestions.md) §E.2–E.3).
- Add the 4 new unit tests ([04](04-curation-and-suggestions.md) §E.4); keep the existing 23 green.

**Verify:** `pnpm --filter @opennpc/mapping run test`.

---

## Step 6 — Mapping ownership flag (`apps/api`)

**File:** `apps/api/src/routes/mappings.ts`.

- In the PATCH handler, set `autoDrafted: false` on any edit
  ([04](04-curation-and-suggestions.md) §D.2 step 1).
- (Optional) add `POST /projects/:id/mappings/:mappingId/approve` setting `approvedBy`/`approvedAt`.

**Verify:** `pnpm --filter @opennpc/api run typecheck`.

---

## Step 7 — The `/analysis` API (`apps/api`, new)

**Files:** `apps/api/src/routes/analysis.ts` (new), register in `server.ts`.

- `analysisRoutes(app)` with `app.addHook("preHandler", requireAuth)` (mirror `mappings.ts:12-13`).
- `GET /projects/:id/analysis` (+ `?format=json|md`):
  - `getOwnedProject` guard; load latest `analyze` `StageRun` with `objectRuns` + `audit`; 400 if none.
  - `buildAnalysisReport(stageRun, mappings, connections)` — **pure**, in a helper module
    (e.g. `apps/api/src/lib/analysisReport.ts`) so it's unit-testable; do **not** strip
    `checkpoint.fields` here.
  - `format==="md"` → `renderAnalysisMarkdown(report)` as `text/markdown` attachment;
    `format==="json"` → JSON attachment; else JSON body.
- Register after `mappingRoutes` in `server.ts` (`await app.register(analysisRoutes);`).
- **Unit test** `buildAnalysisReport` + `renderAnalysisMarkdown` with a fixture `StageRun`
  (`apps/api/src/lib/analysisReport.test.ts`): warning derivation, Markdown structure.

**Verify:** `pnpm --filter @opennpc/api run typecheck && pnpm --filter @opennpc/api run test`.

---

## Step 8 — The report web page (`apps/web`, new)

**Files:** `apps/web/app/projects/[id]/analysis/page.tsx` (new), link from `[id]/page.tsx`,
maybe `lib/api.ts` (blob download helper).

- Page: `useSession` guard, `apiGet<AnalysisReport>('/projects/:id/analysis')`, render the 9 sections
  ([02](02-analysis-report.md) §3) with `card`/`btn`/`input` and the existing pill patterns. Note the
  file lives one level deeper than the project page → import styles from `../../../lib/api` (same depth
  as the mappings page).
- Download buttons: anchors to `${API_BASE}/projects/:id/analysis?format=md` / `?format=json`. If the
  cross-origin cookie doesn't ride the plain navigation, add `apiGetBlob(path)` in `lib/api.ts`
  (`fetch` with `credentials:"include"`, `URL.createObjectURL`, click a temp `<a download>`).
- Link from the project page: a "View analysis report →" action on `AnalyzePanel` (next to the
  existing Mapping Editor link block), enabled once Analyze has a run.

**Verify:** `pnpm --filter @opennpc/web run typecheck`.

---

## Step 9 — Full typecheck + tests

```bash
pnpm -r run typecheck
pnpm -r run test
```

Then hand off to [06-verification.md](06-verification.md) for the live end-to-end run.

---

## Dependency order (quick view)

```
1 salesforce (widen) ─┬─> 4 worker (capture + preserve) ──> 7 api (/analysis) ──> 8 web (report page)
2 salesforce (audit) ─┘                                   ┌─> 6 api (ownership flag)
3 db (audit column) ─────────────────────────────────────┘
5 mapping (drafts) ──> 4 (draft input) & 7 (warnings)
```

Steps 1–3 are independent and can land first; 4 depends on 1–3 and 5; 6 is independent; 7 depends on
3–5; 8 depends on 7.
