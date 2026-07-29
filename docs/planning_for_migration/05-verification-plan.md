# 05 · Verification Plan

[← Roadmap](04-roadmap.md) · [Index](README.md)

---

## Standing gates (every phase)

```bash
pnpm -r run typecheck                      # all 7 packages
pnpm -r run test                           # 107 tests as of Phase 1
pnpm --filter @opennpc/web run build       # all routes compile
```

Plus, after any `schema.prisma` change: **you** run `pnpm db:push`, then
`pnpm --filter @opennpc/db run generate`.

---

## Phase 1 — verify by re-running Analyze on the real org

The objective proof is a **diff of the analysis report** against
`docs/analysis/npsp-analysis-5a091b4e-…md` (the pre-fix baseline).

| # | Check | Before | Expected after |
|---|---|---|---|
| 1 | `npsp__General_Accounting_Unit__c` mapping | `— / unmapped` | **`GiftDesignation` / curated** |
| 2 | RD, Allocation, Partial Soft Credit, Relationship in Mapping Summary | **absent entirely** | present with curated targets |
| 3 | Readiness WARN rows | 11 (all bogus `missing fields: OwnerId`) | **0** |
| 4 | `unmapped-required-target-field` warnings | 2 (both read-only rollups) | 0 for rollups; only genuinely writable required fields |
| 5 | Polymorphic `info` warnings | 212 | **~7** (Task/Event `WhoId`/`WhatId`, `CampaignMember.LeadOrContactId`, `Case.SourceId`) |
| 6 | `unmapped-object-with-data` warnings | 57 (40 = custom settings) | **~17** |
| 7 | Custom Settings drafted as mappings | 6 (`npsp__Gift_Entry_Settings__c → GiftEntry`, …) | **0** |
| 8 | NPSP Configuration section | `"1 row(s)"` × 5 | field **values**, incl. account model + RD1/RD2 |
| 9 | Workflow (118) / Duplicate (11) rules | counted only | **listed as rows** |
| 10 | TDTM object names | `Allocation__c` | `npsp__Allocation__c` |
| 11 | Target Readiness rows in Markdown | 1,074 | ~21 + a collapsed `<details>` for the rest |
| 12 | Multi-source collision (`Account` + `Contact` → `Account`) | silent | a `multi-source-same-target` warning |

**Donor linkage (the headline fix)** — run Transform and confirm the staged output carries the donor:

```sql
SELECT transformed->>'Donor.Legacy_NPSP_Id__c' AS donor_key, count(*)
FROM staging_target
WHERE project_id = '<id>' AND target_object = 'GiftTransaction'
GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
```

Every row with a primary contact must have a non-null `donor_key`. Rows without one are gifts whose
NPSP `npsp__Primary_Contact__c` was blank — count them and report the number rather than hiding it.

> **Note on this sandbox:** the NPSP transactional objects hold 0 records there, so checks 1, 2 and 8
> prove the *mapping and detection* are right, not the *data movement*. Moving data through
> RD/Allocation/Soft-Credit needs an org with those records — ideally a production copy.

---

## Phase 2 — cardinality

1. An `npe03__Recurring_Donation__c` produces **two** staged records: a `GiftCommitment` and a
   `GiftCommitmentSchedule` whose parent key equals the commitment's `Legacy_NPSP_Id__c`.
2. `id_xref` holds **both** rows for that one source Id (impossible before the key change).
3. Re-running Load still yields **zero duplicates**.
4. A mapping with a filter survives a full re-Analyze round trip with the filter intact.
5. An operator can add a lookup through the Mapping Editor API and see it applied.

## Phase 3 — structural transforms

1. An Opportunity with N Payments produces **one** `GiftTransaction` with N installments under
   `paymentSplit: installments`, and **N** gifts under `separate-gifts`.
2. A multi-member Household produces one `PartyRelationshipGroup` with the correct `PartyRoleRelation`
   members and the configured primary contact.
3. Non-primary `OpportunityContactRole` rows become `GiftSoftCredit` records attached to the right gift.
4. The Transform preview's counts equal what Load actually writes.
5. Financial totals reconcile: `SUM(Opportunity.Amount where Closed Won)` = `SUM(GiftTransaction.OriginalAmount)`.

## Phase 4 — load & validate

1. A deliberately broken relationship is caught by the integrity check.
2. Allocations for a gift sum to the gift amount (or the discrepancy is reported).
3. Circular references (`Campaign.ParentId`) resolve after the second pass.
4. `Task.WhoId` re-links to the correct Person Account.
5. The report grades PASS / PASS-WITH-NOTES / FAIL and exports HTML/CSV/JSON.

---

## Regression discipline

Two test classes must grow with every mapping added:

```ts
// 1. The target object must exist in a real NPC org.
test("no curated mapping targets an object that doesn't exist in NPC", …)

// 2. Value maps must emit only legal picklist values.
test("StageName value map only emits legal GiftTransaction.Status values", …)
```

These two catch the exact class of defect that made the GAU mapping silently dead — a wrong target name
and an unverified picklist value are both invisible until a real migration fails.
