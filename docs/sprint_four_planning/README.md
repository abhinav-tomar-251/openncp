# Sprint 4 — Deep NPSP Org Analysis + Analysis Report

> **Goal of this sprint:** make the **Analyze** stage do what the product promises — build a
> *proper, metadata-complete understanding* of the connected **NPSP (source)** org and produce a
> **human-readable analysis report/document** the operator can rely on before mapping, transforming,
> and migrating into a fresh, blank **NPC (target)** org.

This folder is a **fresh planning set** for Sprint 4. It intentionally does **not** edit or depend on
the older `docs/01…17` PRD — start here.

---

## The one-paragraph assessment

Your architecture is **sound and worth keeping** — the durable state machine, per-object
restartability, idempotent `Legacy_NPSP_Id__c` upserts, the DB-backed dynamic mapping layer, and the
Mapping Editor are all correct. **This sprint is a *deepening*, not a rewrite.** Three concrete gaps
stand between what exists and the workflow you described:

1. **Analysis is shallow.** Analyze already *fetches* rich field metadata via `describe()` but then
   **discards almost all of it**, keeping only name/label/type. Deeper org configuration (validation
   rules, flows, triggers, NPSP settings) is never captured.
2. **There is no analysis report.** The operator only sees status + counts + three tables. No schema
   narrative, no field dictionary, nothing downloadable.
3. **Re-running Analyze silently wipes mapping edits** — a bug sitting inside your
   analyze → review → transform loop.

Sprint 4 closes all three.

---

## Locked decisions (from the scoping questions)

| Decision | Choice |
|---|---|
| **Analysis depth** | **Full audit** — schema depth **+** org configuration (validation rules, flows, Apex/TDTM triggers, workflow & duplicate rules, NPSP Custom Settings) via Tooling/Metadata API |
| **Report format** | **In-app + downloadable** — a rendered report page **and** Markdown + JSON export |
| **Target (NPC) org** | **Readiness check only** — it's a fresh blank org; confirm the mapped target objects/fields exist, don't deep-audit it |
| **Extra scope** | **Report + preserve curation** — fix re-Analyze wiping mappings, and make auto-draft suggestions type/picklist-aware. Pipeline hardening is **deferred**. |

---

## Read in this order

| # | Document | What it covers |
|---|----------|----------------|
| — | [README.md](README.md) | This index + the assessment |
| 00 | [Overview & Assessment](00-overview-and-assessment.md) | Why this sprint, evidence of the gaps, scope boundaries, success criteria |
| 01 | [Deep Metadata Capture](01-deep-metadata-capture.md) | Widen field metadata (the "free win") + the new Tooling/Metadata org-config audit + data model |
| 02 | [Analysis Report](02-analysis-report.md) | Report structure, the `/analysis` API, the report web page, Markdown/JSON export |
| 03 | [Target Readiness](03-target-readiness.md) | The light NPC readiness check and how it surfaces in the report |
| 04 | [Curation & Suggestions](04-curation-and-suggestions.md) | Preserve mapping edits across re-Analyze + type/picklist-aware draft suggestions |
| 05 | [Implementation Steps](05-implementation-steps.md) | **Step-by-step build order with concrete code** |
| 06 | [Verification](06-verification.md) | How to test the whole thing end-to-end |

---

## Files touched (summary)

| Area | Files |
|---|---|
| Salesforce | `packages/salesforce/src/discovery.ts` (widen), `orgAudit.ts` (**new**), `index.ts` (exports) |
| DB | `packages/db/prisma/schema.prisma` (add `StageRun.audit Json?`) → `pnpm db:push` |
| Worker | `apps/worker/src/jobs/analyze.ts` (capture audit, preserve curation, richer draft input) |
| API | `apps/api/src/routes/analysis.ts` (**new**), `server.ts` (register), `mappings.ts` (mark user-owned) |
| Web | `apps/web/app/projects/[id]/analysis/page.tsx` (**new**), `[id]/page.tsx` (link), `lib/api.ts` |
| Mapping | `packages/mapping/src/draft.ts` + `draft.test.ts` (picklist/required-aware) |

> **You run these yourself** (per your local setup): `pnpm db:push`, and restart worker + web.
> I never touch your database directly.
