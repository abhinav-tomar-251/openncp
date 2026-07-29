# 03 · Automation & Guidance — the hybrid model

[← Engine Architecture](02-engine-architecture.md) · [Index](README.md) · Next: [Roadmap →](04-roadmap.md)

---

## The principle

> **Automate everything that has a defensible default. Ask only where the answer changes money or
> meaning — and when you ask, make the recommended answer obvious.**

The migration should run end-to-end for an operator who accepts every default, while still letting a
consultant override any single decision. Three tiers:

| Tier | Behaviour | Example |
|---|---|---|
| **Auto** | Applied silently; visible in the report | Field renames, picklist translation, owner remap, external-id stamping |
| **Auto + review gate** | Computed with a default, **shown before it runs**, overridable | Structural transforms; heuristic mapping drafts |
| **Ask** | Blocks until the operator decides; no silent default | The money-affecting decisions below |

Tier 2 is the default for structural transforms (the locked decision). Nothing unreviewed ever writes
to the target org — heuristic drafts still ship disabled.

---

## The decisions we must ask (`docs/05 §9`, now with concrete defaults)

Each becomes a project-level setting surfaced at the **Analyze review gate**, stored on
`migration_project.scope`, and echoed in the analysis report so the choice is auditable.

### 1. Multi-payment Opportunity split
*When an Opportunity has several `npe01__OppPayment__c` rows.*

| Option | Result |
|---|---|
| **Single gift + installments** *(default)* | One `GiftTransaction`; payments become its schedule/installments |
| Separate gifts | One `GiftTransaction` per payment |

**Why the default:** it preserves the donor's intent (one gift of $1,200 paid monthly) and keeps
financial totals reconcilable against NPSP.
*In the studied org: 19 Payments against 6,252 Opportunities — a rare case, but it must be decided.*

### 2. Open pledges and write-offs
| Option | Result |
|---|---|
| **Migrate with remaining balance** *(default)* | `Status = Unpaid`, balance preserved |
| Close as written-off | `Status = Written-Off` |
| Skip | not migrated |

### 3. Household consolidation / primary contact
*Only applies when `npe01__Account_Processor__c` is `Household Account` — Analyze now detects this.*

| Option | Result |
|---|---|
| **Primary contact = NPSP's `npe01__One2OneContact__c`** *(default)* | that Contact's Person Account leads the group |
| Oldest contact / most gifts | alternative rules |

Multi-member households additionally produce a `PartyRelationshipGroup` with `PartyRoleRelation`
members.

### 4. Custom NPSP fields with no NPC home
| Option | Result |
|---|---|
| **Skip** *(default)* | field not migrated; listed in the report |
| Create a custom field on the target | provisioned during Prepare Target |

### 5. Picklist values present in source but absent in target
| Option | Result |
|---|---|
| **Map to the closest legal value** *(default, shown for confirmation)* | e.g. `Cultivating → Pending` |
| Add the value to the target picklist | provisioned during Prepare Target |
| Reject those records | surfaced as errors |

⚠️ *Real example from the studied org:* `npe03__Installment_Period__c` includes **`1st and 15th`** and
`Half Yearly`, which have no single NPC `TransactionPeriod`. Default: `Custom`.

---

## How guidance is delivered

The product already has the surfaces; they extend rather than multiply:

1. **The analysis report** explains *why* each warning exists and *what to do* — already implemented,
   and every warning now carries `why` + `action`.
2. **The Mapping Editor** shows curated/heuristic/unmapped confidence, target readiness per row, and a
   "needs attention" filter — already implemented.
3. **The in-app Guide** (`/guide`) walks the whole migration in plain language — already implemented;
   corrected in this pass to distinguish delivered from planned.
4. **New (Phase 3):** an **operator-decisions panel** at the Analyze gate presenting the five decisions
   above with defaults pre-selected, and a **transform preview** at the Transform gate:
   *"6,252 Opportunities + 19 Payments → 6,252 Gift Transactions · 4,180 with a donor · 19 with
   installments"* — approve, adjust, or disable before anything is written.

## When automation must step aside

Some things the platform will not do automatically, and says so:

| Not automated | Guidance given |
|---|---|
| Validation rules, flows, Apex triggers, workflow rules | The audit lists exactly what exists so the operator can decide what to recreate in NPC |
| **Duplicate rules** | Listed — an active rule will block Load; usually deactivated during migration |
| Person Accounts / Fundraising enablement | Detected, and a single clear blocker links to the Guide's setup section |
| Reports, dashboards, page layouts | Out of scope; stated plainly |
| Polymorphic re-linking (`WhoId`/`WhatId`) | Flagged per object with "re-link manually after Load" until Phase 4 |
