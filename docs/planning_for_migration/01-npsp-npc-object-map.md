# 01 · NPSP ↔ NPC Object Map (authoritative)

[← Gap Analysis](00-gap-analysis.md) · [Index](README.md) · Next: [Engine Architecture →](02-engine-architecture.md)

---

> **Every NPC object name below was verified against a real NPC org's 1,074-object inventory.**
> Field-level detail comes from Salesforce's Nonprofit Cloud developer reference. Where this document
> and `docs/05-data-model-mapping.md` disagree, **this document is correct**.

## Verified NPC object inventory (the ones that matter)

**Present ✅** — `GiftTransaction` · `GiftCommitment` · `GiftCommitmentSchedule` · `GiftDesignation` ·
`GiftTransactionDesignation` · `GiftSoftCredit` · `GiftTribute` · `GiftDefaultDesignation` ·
`GiftDefaultSoftCredit` · `GiftRefund` · `GiftEntry` · `GiftBatch` · `PaymentInstrument` ·
`PartyRelationshipGroup` · `PartyRoleRelation` · `AccountContactRelation` · `ContactContactRelation` ·
`AccountAccountRelation` · `ContactPointAddress` · `ContactPointEmail` · `ContactPointPhone` ·
`Program` · `ProgramEnrollment` · `ProgramCohort` · `ProgramCohortMember` · `Benefit` ·
`BenefitAssignment` · `BenefitDisbursement` · `BenefitSchedule` · `BenefitSession`

**Absent ❌** — `Designation` · `GivingTier` · `PartyRelationshipGroupMember` · `PersonAccount`
(a Person Account *is* an `Account` with a person record type, not its own object)

---

## Cardinality legend

| Symbol | Meaning | Expressible today? |
|---|---|---|
| **1:1** | one source record → one target record | ✅ yes |
| **1→N** | one source record → several target records (possibly different objects) | ❌ needs Phase 2 |
| **N→1** | several source records merge into one target record | ❌ needs Phase 3 |

---

## A. Constituents

### `Contact` → `Account` (Person Account) — **1:1** ✅ *implemented*
NPSP splits a person across a Contact and a Household Account; NPC merges them into one Person Account.

| NPSP | NPC | Note |
|---|---|---|
| `FirstName`/`LastName`/`Salutation` | same | |
| `Email` | `PersonEmail` | |
| `MobilePhone` | `PersonMobilePhone` | |
| `Phone` | `Phone` | |
| `Birthdate` | `PersonBirthdate` | |
| `Mailing*` | `PersonMailing*` | |
| — | `RecordTypeId` | resolved live via `findPersonAccountRecordTypeId` |

`Title` is deliberately omitted — Person Accounts don't expose it the way Contacts do.

### `Account` (Household, multi-member) → `PartyRelationshipGroup` + members — **N→1 + 1→N** ❌ Phase 3
Members join via **`PartyRoleRelation`** (there is no `PartyRelationshipGroupMember`). The account
model (`npe01__Account_Processor__c`) decides whether this applies at all — a One-to-One or Bucket org
has no multi-member households to build.

### `Account` (Organization) → `Account` (Business) — **1:1** ⚠️ *needs a record-type filter*
Direct field mapping, but must exclude Household accounts — which requires a **persistable filter**
(Phase 2). Until then, enabling a raw `Account → Account` mapping alongside `Contact → Account` also
trips the new `multi-source-same-target` warning.

### `npsp__Address__c` → `ContactPointAddress` — **1→N** ❌ Phase 2
One NPSP Address can produce several contact points (seasonal/secondary addresses).

---

## B. Gifts

### `Opportunity` → `GiftTransaction` — **1:1** ✅ *implemented (donor linkage fixed)*

| NPSP | NPC | Note |
|---|---|---|
| `Amount` | `OriginalAmount` | reconcile field |
| `CloseDate` | `TransactionDate` | |
| `StageName` | `Status` | value-mapped ↓ |
| `Description` | `Description` | |
| `npsp__Primary_Contact__c` | **`Donor`** (→ Person Account) | **the fix that stops gifts being orphaned** |
| `CampaignId` | `Campaign` | |
| `npe03__Recurring_Donation__c` | `GiftCommitment` | links installment gifts to their commitment |

**StageName → Status** (verified picklists on both sides):

| NPSP StageName | NPC Status |
|---|---|
| Closed Won | `Paid` |
| Pledged | `Unpaid` |
| Closed Lost | `Canceled` |
| Prospecting / Cultivating | `Pending` |

Legal `GiftTransaction.Status`: `Canceled`, `Failed`, `Fully Refunded`, `Paid`, `Pending`, `Unpaid`,
`Written-Off`. `PaymentMethod` is required by NPC and has no NPSP equivalent — supply a constant or map
an org-specific field.

### `npe01__OppPayment__c` → folded into `GiftTransaction` — **N→1** ❌ Phase 3
An NPSP Payment is an *installment of a gift*, so N payments collapse into their parent gift (or split
into separate gifts, per policy). **Not** `PaymentInstrument` — that's a stored card. Business decision
required: single gift + installments vs separate gifts (see
[03-automation-and-guidance.md](03-automation-and-guidance.md)).

### `OpportunityContactRole` → `GiftSoftCredit` / donor role — **1:1 conditional** ⚠️ Phase 2
The *primary* role sets the gift's donor (already handled via `npsp__Primary_Contact__c`); non-primary
roles become soft credits. Splitting on `IsPrimary` needs a persistable filter.

### Tributes (`npsp__Honoree_Contact__c`, `npsp__Tribute_Type__c`) → `GiftTribute` — **1→N** ❌ Phase 2
`GiftTribute` exists in NPC. Alternatively `GiftSoftCredit` with `Role = Honoree` — both are valid;
`GiftTribute` is the more faithful shape. Source picklist `npsp__Tribute_Type__c`: `Honor`, `Memorial`.

---

## C. Recurring giving

### `npe03__Recurring_Donation__c` → `GiftCommitment` — **1:1** ✅ *implemented*

| NPSP | NPC | Note |
|---|---|---|
| `npe03__Amount__c` | `ExpectedTotalCmtAmount` | |
| `npe03__Open_Ended_Status__c` | `Status` | Open→`Active`, Closed→`Closed`, None→`Draft` |
| `npe03__Contact__c` | `Donor` (→ Person Account) | |
| `npe03__Recurring_Donation_Campaign__c` | `Campaign` | |

Legal `GiftCommitment.Status`: `Draft`, `Active`, `Paused`, `Failing`, `Lapsed`, `Closed`.

### RD schedule → `GiftCommitmentSchedule` — **1→N** ❌ Phase 2
A master-detail child of the commitment. **Classic (RD1) and Enhanced (RD2) have different schedule
shapes** — Analyze now detects which is live from the TDTM registrations.

| NPSP (classic) | NPC |
|---|---|
| `npe03__Installment_Period__c` | `TransactionPeriod` (`Daily`/`Weekly`/`Monthly`/`Yearly`/`Custom`) |
| `npe03__Amount__c` | `TransactionAmount` |
| `npe03__Date_Established__c` | `StartDate` |
| `npe03__Installments__c` | drives `RecurrenceType` (Fixed Length vs Open Ended) |
| — | `TransactionDay` (1–30 or `LastDay`) — required when period is Monthly |

⚠️ The real org's `npe03__Installment_Period__c` includes **`1st and 15th`** and `Half Yearly`, which
have no single NPC period — these need `TransactionPeriod = Custom` or two schedules. A genuine
business decision.

---

## D. Designations & allocations

### `npsp__General_Accounting_Unit__c` → `GiftDesignation` — **1:1** ✅ *implemented*
`Name` → `Name`, `npsp__Description__c` → `Description`, `npsp__Active__c` → `IsActive`.

### `npsp__Allocation__c` → `GiftTransactionDesignation` — **1:1** ✅ *implemented*

| NPSP | NPC |
|---|---|
| `npsp__Amount__c` | `Amount` |
| `npsp__Percent__c` | `Percent` |
| `npsp__Opportunity__c` | `GiftTransaction` (master-detail) |
| `npsp__General_Accounting_Unit__c` | `GiftDesignation` |

⚠️ An Allocation can hang off a **Recurring Donation** (`npsp__Recurring_Donation__c`) instead of an
Opportunity — that variant belongs on `GiftDefaultDesignation`, a conditional target needing Phase 2.

---

## E. Soft credits

### `npsp__Partial_Soft_Credit__c` → `GiftSoftCredit` — **1:1** ✅ *implemented*

| NPSP | NPC |
|---|---|
| `npsp__Amount__c` | `PartialAmount` |
| `npsp__Role_Name__c` | `Role` (value-mapped) |
| `npsp__Opportunity__c` | `GiftTransaction` (master-detail) |
| `npsp__Contact__c` | `Recipient` (→ Person Account) |

Legal `GiftSoftCredit.Role`: `Honoree`, `Household Member`, `Influencer`, `Matched Donor`, `Other`,
`Soft Credit`, `Solicitor`, `Third Party Donor`. Percentages across a gift need not total 100%.

### `npsp__Account_Soft_Credit__c` → `GiftSoftCredit` — **1:1** ⚠️ Phase 5
Same target with an organization recipient; not yet curated.

---

## F. Relationships & affiliations

### `npe5__Affiliation__c` → `AccountContactRelation` — **1:1** ✅ *implemented*
NPC uses "Contacts to Multiple Accounts" rather than a Party object for person↔org.
`npe5__Role__c` → `Roles`, `npe5__Primary__c` → `IsDirect`, `npe5__StartDate__c`/`npe5__EndDate__c` →
`StartDate`/`EndDate`.

### `npe4__Relationship__c` → `ContactContactRelation` — **1:1** ✅ *implemented, with a caveat*
`npe4__Type__c` → `Roles`, `npe4__Description__c` → `Description`, both contacts → `Contact` /
`RelatedContact`.

⚠️ **NPSP auto-creates a reciprocal row for every relationship.** Deduplicating those pairs needs a
persistable filter (Phase 2); until then both directions migrate.

---

## G. Campaigns & activities

| NPSP | NPC | Cardinality | Status |
|---|---|---|---|
| `Campaign` | `Campaign` | 1:1 | ✅ implemented |
| `CampaignMember` | `CampaignMember` | 1:1 | ⚠️ needs `LeadOrContactId` polymorphic handling (Phase 4) |
| `Task` / `Event` | `Task` / `Event` | 1:1 | ✅ implemented; `WhoId`/`WhatId` not re-linked (Phase 4) |

---

## H. Programs (only if PMM `pmdm__` installed) — Phase 5

`pmdm__Program__c` → `Program` · `pmdm__ProgramEngagement__c` → `ProgramEnrollment` ·
`pmdm__Service__c` → `Benefit` · `pmdm__ServiceDelivery__c` → `BenefitDisbursement` ·
cohorts → `ProgramCohort` / `ProgramCohortMember`.

*(The real org studied has no `pmdm__` objects — PMM is not installed there.)*

---

## I. Deliberately not migrated

| NPSP | Why |
|---|---|
| `npsp__DataImport__c`, `npsp__DataImportBatch__c`, `npsp__Batch__c` | NPSP's own staging scaffolding |
| `*_Settings__c` (all hierarchy Custom Settings) | configuration, not data — captured in the report instead |
| `npsp__Trigger_Handler__c` | NPSP trigger framework config; surfaced in the audit |
| `npsp__Error__c`, `npe4__Relationship_Error__c` | operational logs |
| `npsp__Level__c` | no confirmed NPC equivalent (`GivingTier` does not exist) |
| `npsp__Engagement_Plan__c` / `_Task__c` | no single 1:1 NPC target; Phase 5 will map to Tasks |
| Rollup fields (`npo02__*` on Contact/Account) | NPC recalculates its own rollups after load |

---

## Load dependency order

Parents must exist before children so external-id relationship resolution works:

```
GiftDesignation
  └─ Account (Person + Business)
       ├─ Campaign
       ├─ GiftCommitment            (→ Donor, Campaign)
       │    └─ GiftTransaction      (→ Donor, Campaign, GiftCommitment)
       │         ├─ GiftTransactionDesignation  (→ GiftTransaction, GiftDesignation)
       │         ├─ GiftSoftCredit             (→ GiftTransaction, Recipient)
       │         └─ GiftTribute
       ├─ AccountContactRelation
       └─ ContactContactRelation
Task · Event (last — no dependants)
```

This is encoded in `TARGET_LOAD_ORDER` (`packages/mapping/src/defaults.ts`) and asserted by tests.
Phase 4 replaces the static list with an order derived from the mappings' own lookups.
