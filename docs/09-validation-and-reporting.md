# 09 · Validation & Reporting

[← Transformation Engine](08-transformation-engine.md) · [Index](README.md) · Next: [API & Jobs →](10-api-and-jobs.md)

---

Stage 5 (**Validate**) proves the migration is correct and produces the artifact the operator shows
to leadership. There are two layers of validation: **pre-load** (in Transform, covered in
[08](08-transformation-engine.md)) and **post-load reconciliation** (here).

## 1. Reconciliation checks

After Load, the validator reads back from the **target** org (read-only) and compares against the
source/staging:

| Check | Method | Pass condition |
|-------|--------|----------------|
| **Record counts** | `COUNT()` per object, source vs target (accounting for model collapses, e.g. Opp+Payment → Gift) | Counts match the expected mapping ratio |
| **Financial totals** | `SUM(Opportunity.Amount where Won)` vs `SUM(GiftTransaction.Amount)` | Totals equal (within rounding tolerance) |
| **Recurring totals** | Sum/active count of Recurring Donations vs Gift Commitments | Equal |
| **Designation allocations** | Sum of allocations per gift = gift amount | Balanced |
| **Relationship integrity** | Sampled lookups resolve to correct target parents via `id_xref` | No dangling references |
| **Spot-checks** | N random records compared field-by-field (source → target via `Legacy_NPSP_Id__c`) | Fields match per mapping |
| **Orphans/duplicates** | Target records without a `Legacy_NPSP_Id__c`, or duplicate external ids | None |

The `Legacy_NPSP_Id__c` external id is the join key that makes source↔target record comparison exact.

## 2. Discrepancy handling → targeted re-run

When a check fails, the report links each discrepancy to its `object_run` and (where possible) the
offending records in `migration_error`. The operator can:

- **Re-run only the affected object** (e.g. re-load failed Gift Transactions).
- **Fix the mapping** and re-run Transform → Load for that object.
- Mark a discrepancy **accepted** with a note (e.g. an intentional data-cleanup difference), which is
  recorded for audit.

This closes the loop in the state machine: Validate can send work back to Transform/Load without
redoing the whole migration (see [04-migration-workflow.md](04-migration-workflow.md) §8).

## 3. Rollups

NPSP rollups (donation totals, last/largest gift, etc.) are recomputed differently in NPC. After
Load, the validator can **trigger the target org's rollup recalculation** so NPC summary fields
reflect the migrated gifts, then re-read totals to confirm. Triggering rollups is the only write the
Validate stage performs.

## 4. Migration report

The deliverable artifact, exportable as **HTML**, **CSV**, and **JSON**:

```
Migration Report — <project name>
Generated: <timestamp> · Source org: <id> · Target org: <id>

SUMMARY
  Overall status: PASS / PASS WITH NOTES / FAIL
  Objects migrated: 14 / 14
  Records loaded: 412,338  ·  Errors: 27 (retryable: 25)

RECONCILIATION
  Object              Source    Target    Expected   Result
  Person Accounts     76,543    76,543    =          PASS
  Gift Transactions   201,118   201,118   =          PASS
  Gift Commitments    8,902     8,902     =          PASS
  Designations        144       144       =          PASS
  Sum(Gift Amount)    $9,481,203.55  $9,481,203.55   PASS

ERRORS (27)
  <object> · <source_id> · <message> · retryable

NOTES / ACCEPTED DISCREPANCIES
  <object> · <reason> · <accepted_by>
```

The report is generated from `stage_run.stats`, `object_run` counts, `migration_error`, and the live
reconciliation queries — fully reproducible from the database.

## 5. Go-live checklist (surfaced in the UI)

Beyond automated reconciliation, the Validate gate presents a manual smoke-test checklist for the
operator to confirm in the target org:

- Login & permissions work for end users.
- A sample donor's gifts, commitments, soft credits, and designations display correctly.
- Creating a new Gift Transaction works.
- Program enrollment functions (if Programs in scope).
- Reports/dashboards built on NPC objects return expected totals.
- Automations (Flows) on NPC objects run without error.

Only after both automated reconciliation **and** the manual checklist pass does the operator mark the
migration **complete**.
