# 00 · Gap Analysis — Promised vs Built vs What a Real Org Needs

[Index](README.md) · Next: [Object Map →](01-npsp-npc-object-map.md)

---

## Evidence base

| Source | What it gave us |
|---|---|
| **Real NPSP org** (`docs/analysis/npsp-analysis-5a091b4e-…md`, 14,100 lines) | 282 objects, 78,458 records, 108 validation rules, 246 flows, 100 Apex triggers, 55 TDTM handlers |
| **Real NPC org inventory** (same report, target side) | 1,074 objects — the ground truth for which NPC object names actually exist |
| **Salesforce NPC developer reference** | Field-level detail for `GiftTransaction`, `GiftCommitment`, `GiftCommitmentSchedule`, `GiftTransactionDesignation`, `GiftSoftCredit` |
| **Code audit** | `packages/mapping/src/engine.ts`, `defaults.ts`, `apps/worker/src/jobs/*`, `apps/api/src/lib/analysisReport.ts` |

### The source org at a glance

| Object | Records | Fields | Note |
|---|---:|---:|---|
| `CampaignMember` | 13,176 | 145 | largest object |
| `Account` | 12,317 | 513 | Household + Organization accounts |
| `Contact` | 11,999 | 916 | |
| `OpportunityContactRole` | 9,777 | 14 | soft credits + donor roles |
| `Opportunity` | 6,252 | 259 | 8 record types |
| `OpportunityLineItem` | 6,252 | 94 | products on gifts |
| `npe5__Affiliation__c` | 103 | 36 | |
| `npe01__OppPayment__c` | 19 | 21 | |
| `npe03__Recurring_Donation__c` | **0** | **157** | 10 validation rules, 13 flows, 4 TDTM handlers |
| `npsp__Allocation__c` | **0** | 15 | |
| `npsp__Partial_Soft_Credit__c` | **0** | 27 | |
| `npe4__Relationship__c` | **0** | 18 | |

> **The critical read:** this sandbox is *scrubbed*, not *unused*. Recurring Donations has 157 fields,
> ten validation rules (Direct Debit/BSB banking, cancellation reasons, "8th 15th 22nd of a month"),
> thirteen flows and four active TDTM registrations. It is central to the business in production. Any
> design that keys off record counts alone will miss the most important translations.

---

## The 13 defects (all fixed in Phase 1 unless noted)

### 1. The GAU mapping pointed at an object that doesn't exist ✅ fixed
`DEFAULT_MAPPINGS` targeted **`Designation`**. A real NPC org has **`GiftDesignation`**; `Designation`
returns zero rows in the 1,074-object inventory. Because a curated seed only wins when its target
exists, the mapping fell through to `unmapped` — and, as a knock-on, only 5 objects were ever
schema-checked.

### 2. Every migrated gift was orphaned ✅ fixed
`Opportunity → GiftTransaction` carried exactly one lookup: `CampaignId`. `GiftTransaction.DonorId`
was never populated, so every gift would land in NPC attached to no one.

**Fix:** map `npsp__Primary_Contact__c → Donor`. Deliberately *not* `AccountId`: in NPSP's Household
model that's the Household Account, which is not a constituent under NPC's Person Account model.

### 3. Read-only rollups were reported as "required, must map" ✅ fixed
The report told the operator to map `Campaign.NumberOfLeads`, `AmountWonOpportunities`,
`NumberOfContacts` … all of which are `createable: false`. Following that advice guarantees a Load
failure on every record.

**Fix:** `isMappableRequiredField()` — required **and** createable **and** not a formula **and** not an
auto-number.

### 4. `OwnerId` was demanded of every target object ✅ fixed
`targetFieldsForObject` unconditionally added `OwnerId`, so objects that have no `OwnerId` at all
(`CampaignMember`, `OpportunityContactRole`, `PricebookEntry`, `RecordType`, `User`,
`OpportunityLineItem`, …) all WARNed. **All 11 readiness WARNs in the real report were this bug** —
zero true positives.

### 5. Polymorphic-lookup warnings were 97% noise ✅ fixed
212 warnings fired; **205** were `OwnerId` (User|Group — polymorphic on *every* object) or
`SetupOwnerId` (on every hierarchy custom setting). Each carried irrelevant "won't stay linked to their
donor/campaign" copy.

**Fix:** `isMeaningfulPolymorphicLookup()` excludes ownership fields. 212 → ~7 real ones.

### 6. Custom Settings were treated as migratable data ✅ fixed
40 of 57 `unmapped-object-with-data` warnings, and 6 of 17 heuristic drafts, were hierarchy Custom
Settings holding a single org-default row (`npsp__Gift_Entry_Settings__c → GiftEntry` is not a
migration). `describeGlobal()` already returns `customSetting` — it was simply discarded.

### 7. Zero-record objects got no mapping at all ✅ fixed
The drafting gate was `count > 0 || name in DEFAULT_MAPPINGS`. On this scrubbed sandbox that meant
`npe03__Recurring_Donation__c`, `npsp__Allocation__c`, `npsp__Partial_Soft_Credit__c` and
`npe4__Relationship__c` were **absent from the Mapping Summary entirely** — the flagship NPSP→NPC
translations were invisible.

**Fix:** also draft anything NPSP-namespaced (`npsp__`/`npe01__`/`npe03__`/`npe4__`/`npe5__`/`npo02__`/
`pmdm__`), excluding custom settings.

### 8. NPSP configuration captured row counts, not values ✅ fixed
The report said `npo02__Households_Settings__c: 1 row(s)` — and nothing else. The decisive setting,
**`npe01__Account_Processor__c`** (Household Account / One-to-One / Bucket), determines the entire
constituent transform and was never surfaced.

**Fix:** `summarizeNpspConfig()` distils account model, payments-enabled, default GAU, household rules,
and detects **classic RD1 vs Enhanced RD2** from live TDTM registrations. The report now renders values.

### 9. Workflow and Duplicate rules were counted but never listed ✅ fixed
"Workflow Rules (118) · Duplicate Rules (11)" — header only, no rows. Active **duplicate rules block
inserts on the target org**, so this is load-blocking information that was being withheld.

### 10. Two mappings could silently target the same object ✅ fixed
`Account → Account` (heuristic) and `Contact → Account` (curated, Person Account) both existed with no
warning. Reconcile config for a target is taken from whichever mapping is found first, so this is
also a silent data-integrity issue.

### 11. TDTM object names dropped their namespace ✅ fixed
The TDTM table showed `Allocation__c` while every other section used `npsp__Allocation__c`, so any
cross-section join silently missed. **Fix:** `normalizeTdtmObjectName()`.

### 12. The Markdown report was 93% filler ✅ fixed
1,053 `UNMAPPED` rows (of 1,074) plus 11,249 lines of field dictionary in a 14,100-line file. The
Target Readiness section carried 21 rows of actual signal. **Fix:** collapse UNMAPPED into a
`<details>` summary; also escape pipes/newlines so multi-line validation-rule messages stop corrupting
tables.

### 13. `npe01__OppPayment__c → PaymentInstrument` ⚠️ partially addressed
A name-similarity guess. `PaymentInstrument` is a *stored payment method* (a card on file); an NPSP
Payment is an *installment of a gift*. The correct translation is to fold Payments into their parent
`GiftTransaction` — which is an **N→1 merge the engine cannot express** (see
[02-engine-architecture.md](02-engine-architecture.md)). Phase 1 leaves it unmapped-by-default rather
than wrong-by-default; Phase 3 implements the real merge.

---

## Doc-vs-reality corrections applied

| Claim in `docs/05` / `docs/18` | Reality | Action |
|---|---|---|
| GAU → `Designation` | `Designation` doesn't exist | → `GiftDesignation` ✅ |
| `npsp__Level__c` → `GivingTier` | `GivingTier` doesn't exist | removed; no NPC equivalent confirmed ✅ |
| Household → `PartyRelationshipGroup` + `PartyRelationshipGroupMember` | Member object doesn't exist; `PartyRoleRelation` does | corrected ✅ |
| Tributes → `GiftTribute` | **exists** ✅ — and `GiftSoftCredit.Role` also has `Honoree` | both documented ✅ |
| `docs/18` presents Payments/RD-schedule/household-merge as working | not implemented | reworded as planned ✅ |

## Doc-vs-doc contradiction (now resolved)

`docs/sprint_four_planning/00` stated structural transforms were "still out of scope" on the same day
`docs/18` told operators that Payments fold into Gift Transactions and RDs become Commitments +
Schedules. The operator guide was ahead of the code. `docs/18` and the in-app Guide now describe
delivered vs planned honestly.

---

## What remains (not defects — unbuilt capability)

| Gap | Blocked by | Phase |
|---|---|---|
| Opportunity + Payments → one GiftTransaction | N→1 merge | 3 |
| RD → GiftCommitment **+ GiftCommitmentSchedule** | 1→N emit | 2–3 |
| Household + Contacts → Person Account + PartyRelationshipGroup | N→1 **and** 1→N, plus `id_xref` schema | 2–3 |
| `npsp__Address__c` → ContactPointAddress/Email/Phone | 1→N emit | 2–3 |
| Reciprocal relationship dedup, "Closed Won only" | persistable filters | 2 |
| Task/Event `WhoId`/`WhatId` re-linking | polymorphic lookup support | 4 |
| Source→target reconciliation, allocation balancing, orphan checks | Validate depth | 4 |
| Programs/PMM, Engagement Plans, Levels | breadth | 5 |
