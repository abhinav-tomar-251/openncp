# 13 · Roadmap & Milestones

[← Security](12-security.md) · [Index](README.md) · Next: [Testing Strategy →](14-testing-strategy.md)

---

A pragmatic build order: stand up the durable spine first, then one stage at a time end-to-end on a
**narrow vertical slice** (Accounts + Donations) before widening scope. Each milestone is shippable
and demonstrable.

## 1. Release phases

| Release | Theme | Outcome |
|---------|-------|---------|
| **MVP (0.1)** | Vertical slice | Connect both orgs; migrate Households→Person Accounts and Opportunities+Payments→Gift Transactions end-to-end with reconciliation. |
| **v1.0** | Full v1 scope | All in-scope objects: recurring, designations/allocations, soft credits, relationships/affiliations, campaigns, programs (if PMM). Robust resume/retry. Self-host docs. |
| **v1.1** | Files & polish | ContentVersion/Attachments/Notes migration; mapping templates; richer reports. |
| **v2.0** | Scale & extensibility | Plugin marketplace pattern, JWT headless runs, performance hardening for 1M+ records, optional multi-tenant hosting. |

## 2. Build milestones (MVP → v1.0)

> Maps to the architecture in [03](03-architecture.md), the workflow in [04](04-migration-workflow.md),
> and the API/jobs in [10](10-api-and-jobs.md).

| # | Milestone | Acceptance criteria |
|---|-----------|---------------------|
| **M1** | **Foundation** — monorepo (pnpm), Prisma schema + Postgres, pg-boss wired, Docker Compose, health endpoints. | `docker compose up` starts web/api/worker/postgres; a no-op job round-trips through pg-boss. |
| **M2** | **Connect (Stage 0)** — ECA OAuth + PKCE for both orgs, encrypted token storage, capability probe. | Operator connects an NPSP and an NPC org; tokens stored encrypted; capability report shows Person Accounts/limits. |
| **M3** | **Salesforce core** — `bulk2` (query w/ PK chunking, upsert w/ checkpointing) + `schema` discovery. | Can Bulk-query a large object into staging and resume after a kill; can upsert a small set keyed on external id. |
| **M4** | **State machine** — `stage_run`/`object_run`, guarded transitions, review-gate + retry APIs, SSE events. | Stages move only via guarded transitions; a single failed object retries in isolation; UI shows live status. |
| **M5** | **Analyze (Stage 1)** — schema read, record counts, auto-draft mapping, provision ext-ID fields, mapping editor UI. | Readiness report renders; draft mapping generated and editable; `Legacy_NPSP_Id__c` created in target. |
| **M6** | **Extract (Stage 2)** — Bulk query → `staging_source`, per-object progress. | All slice objects extract with counts matching the org; kill-and-resume works. |
| **M7** | **Transform (Stage 3)** — engine + Household→Person Account and Opp+Payment→Gift transforms; `id_xref`; validations; target-prep plan. | Transformed samples correct; errors captured; re-running after a mapping edit re-transforms only. |
| **M8** | **Load (Stage 4)** — dependency-ordered upserts, two-pass cycle resolution, error capture, `id_xref` target ids. | Slice loads into NPC; re-run produces **zero duplicates**; failed records retry in isolation. |
| **M9** | **Validate (Stage 5)** — reconciliation (counts + gift sums), rollup trigger, report export. | Reconciliation PASS on the slice; report exports HTML/CSV/JSON. |
| **M10** | **Breadth** — add recurring→commitments, designations/allocations, soft credits, relationships/affiliations, campaigns, programs. | Each new object passes its own end-to-end + reconciliation. |
| **M11** | **OSS polish** — README, architecture docs, sample mappings, license, CONTRIBUTING, CI. | A new contributor can clone, `docker compose up`, run the test suite, and add a mapping following docs. |

## 3. Suggested sprint breakdown (illustrative, 2-week sprints)

| Sprint | Focus |
|--------|-------|
| S1 | M1 Foundation + M2 Connect |
| S2 | M3 Salesforce core (bulk2 + schema) |
| S3 | M4 State machine + events + UI shell |
| S4 | M5 Analyze + mapping editor |
| S5 | M6 Extract + M7 Transform (slice) |
| S6 | M8 Load + M9 Validate (slice) → **MVP demo** |
| S7–S9 | M10 Breadth (recurring, designations, soft credits, relationships, campaigns, programs) |
| S10 | M11 OSS polish + hardening → **v1.0** |

## 4. Definition of done (per object scope)

An object scope is "done" when:
- It extracts, transforms, and loads end-to-end.
- Its mapping is in `packages/mapping/defaults/` and editable in the UI.
- Re-running its Load is idempotent (no duplicates).
- Its reconciliation check passes on the test dataset.
- It has unit tests for the transform and an integration test through the pipeline.

## 5. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| NPC object/field API names change | Schema-confirmed mappings; unresolved names are blocking validations, not silent failures |
| Org-specific customizations | Configuration-driven mappings + per-project overrides + plugins |
| Very large volumes / API limits | Bulk API 2.0 + PK chunking + checkpointed resume + throttling |
| Ambiguous business mappings (payments, pledges, households) | Explicit operator decisions surfaced in Analyze; no silent money-affecting defaults |
| Scope creep (files, Apex translation) | Phased roadmap; files in v1.1, Apex translation explicitly out of scope |
