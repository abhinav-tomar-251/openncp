# 04 · Roadmap

[← Automation & Guidance](03-automation-and-guidance.md) · [Index](README.md) · Next: [Verification →](05-verification-plan.md)

---

## Phase 1 — Correctness & coverage ✅ **DELIVERED**

Fix what is wrong before building what is missing.

- ✅ GAU → **`GiftDesignation`** (was targeting the non-existent `Designation`)
- ✅ **Donor lookup** on `Opportunity → GiftTransaction` — gifts are no longer orphaned
- ✅ Five new curated mappings: Allocation → `GiftTransactionDesignation`, Partial Soft Credit →
  `GiftSoftCredit`, Recurring Donation → `GiftCommitment`, Affiliation → `AccountContactRelation`,
  Relationship → `ContactContactRelation`
- ✅ Required-field detector honours `createable`/`autoNumber`/`calculated` (13 false positives → 0)
- ✅ `OwnerId` only expected where the object actually has it (11 bogus WARNs → 0)
- ✅ Polymorphic warnings exclude `OwnerId`/`SetupOwnerId` (212 → ~7)
- ✅ Custom Settings excluded from drafting and warnings (~40 fewer warnings)
- ✅ NPSP-namespaced objects drafted even at 0 records
- ✅ NPSP settings **values** captured; classic RD1 vs Enhanced RD2 detected
- ✅ Workflow + Duplicate rules listed; TDTM names namespaced; Markdown cells escaped; UNMAPPED collapsed
- ✅ `multi-source-same-target` collision warning
- ✅ Docs + in-app Guide corrected to real NPC object names and honest delivery status

**Acceptance:** 107 tests green; re-running Analyze on the real org shows the diffs in
[05-verification-plan.md](05-verification-plan.md).

---

## Phase 2 — Engine cardinality *(next)*

**Goal:** one source record can produce several target records, and mappings can carry conditions.

| Work | Detail |
|---|---|
| `applyMapping → TransformResult[]` | empty array replaces `null` |
| `MappingDefinition.emits[]` | child records with `parentRelationship` |
| **`id_xref` schema change** | key on `(projectId, sourceObject, sourceId, targetObject)`; scope `load.ts` write-back — **one `pnpm db:push`** |
| Persistable filters | serialized predicate + pure `evaluatePredicate` |
| Mapping Editor API | accept `lookups` / `valueMap` / `constants` / `filter` |

**Unlocks:** RD → Commitment **+ Schedule** · Address → ContactPoint* · tributes → `GiftTribute` ·
Household-vs-Organization account split · reciprocal-relationship dedup · Closed-Won-only scoping.

**Acceptance:** an RD migrates with its schedule attached; a filtered mapping survives a re-Analyze
round trip; re-running Load still produces zero duplicates.

---

## Phase 3 — Merge/reduce + structural transforms

**Goal:** the six named transforms from `docs/08 §3`, auto-applied with a review-gate preview.

| Work | Detail |
|---|---|
| Key-aware batching | sorted-run reduce so a merge group can't straddle a page |
| `StructuralTransform` contract | `(sourceRecords, ctx) => TransformResult[]`, registered by name |
| Household → Person Account + `PartyRelationshipGroup` | gated on the detected account model |
| Opportunity + Payments → GiftTransaction | honours the `paymentSplit` decision |
| Soft credits from `OpportunityContactRole` | primary → donor, non-primary → `GiftSoftCredit` |
| Operator-decisions panel + transform preview | the five decisions in [03](03-automation-and-guidance.md) |

**Acceptance:** an Opportunity with N payments produces one gift with N installments; a multi-member
household produces one group with the right members; the preview matches what Load actually writes.

---

## Phase 4 — Load & validate depth

| Work | Detail |
|---|---|
| Dynamic load order | topological sort from the mappings' own lookups |
| Second pass | circular/self references (`Campaign.ParentId`, reciprocals) |
| Polymorphic lookups | resolve concrete type from the Id prefix (`WhoId`/`WhatId`/`LeadOrContactId`) |
| Source→target reconciliation | compare NPSP to NPC, not staged to live |
| Allocation balancing · relationship integrity · orphan/duplicate detection | per `docs/09 §1` |
| Rollup trigger + go-live checklist | per `docs/09 §3`/`§5` |

**Acceptance:** the reconciliation report grades PASS / PASS-WITH-NOTES / FAIL and catches a
deliberately broken relationship.

---

## Phase 5 — Breadth

Programs/PMM (`pmdm__*` → `Program`/`ProgramEnrollment`/`Benefit*`) · Engagement Plans → Tasks ·
`npsp__Account_Soft_Credit__c` · Levels (no NPC equivalent — decide: custom field or skip) ·
Files/Attachments/Notes (`docs/13` v1.1) · mapping templates reusable across clients.

---

## Sequencing rationale

Phase 1 delivered value with zero architectural risk. Phase 2 is three small, independent changes that
between them unblock five translations. Phase 3 is the only genuinely invasive phase and benefits from
Phase 2's emit path being proven first. Phases 4–5 are additive.

## Cross-cutting, every phase

- Every new mapping ships with a test asserting its target object **exists in a real NPC org** and its
  value maps emit **legal picklist values** — the class of bug that made GAU silently unmapped.
- Every phase updates the in-app Guide and `docs/18` so operator-facing docs never over-claim.
