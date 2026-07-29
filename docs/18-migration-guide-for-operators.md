# 18 · Migration Guide for Operators

[← Multi-Tenant & OAuth Setup](17-multi-tenant-and-oauth-setup.md) · [Index](README.md)

---

> This is the **operator-facing** companion to [05-data-model-mapping.md](05-data-model-mapping.md) —
> plain language, no engineering background assumed. It mirrors the in-app **Guide** page
> (`/guide` in the web app), which is the primary place to read this while actually running a
> migration. This file exists so the same content is readable offline / before you've connected
> anything.

## How this works

This app connects to your existing NPSP org (the **source**, read-only) and a fresh NPC org (the
**target**), then walks the data through five stages: **Analyze → Extract → Transform → Load →
Validate**. Each stage saves its progress, can be re-run on its own without redoing earlier stages, and
pauses for you to review and approve before the next stage can start — nothing moves data into NPC
without you seeing it first.

You don't need deep Salesforce administration knowledge to follow this guide, but you do need **System
Administrator** access (or equivalent) on both orgs to connect them and to turn on NPC features.

## NPSP vs NPC, in plain language

NPSP (Nonprofit Success Pack) and NPC (Nonprofit Cloud) are **two different products** with different
underlying data models — migrating between them isn't a simple copy. NPSP is a managed package built on
custom objects (names with `npsp__`, `npe01__`, `npe03__` prefixes) using a **Household Account model**
— every person (Contact) belongs to a household (Account). NPC is built on **standard objects** using a
**Person Account** model — a person and their account are merged into one record.

The **Status** column is honest about what the app does *today* versus what still needs a manual step:
✅ = migrates automatically · ⚠️ = migrates partially, see the note · 🔜 = planned, manual for now.

| NPSP | → | NPC | Status | Why this isn't a simple copy |
|---|---|---|---|---|
| Household `Account` + `Contact` | → | **Person Account** | ⚠️ | Each Contact becomes a Person Account. Multi-member households don't yet produce a relationship group — 🔜 planned. |
| `Opportunity` | → | **GiftTransaction** | ✅ | Amount, date, stage→status and the **donor** all carry over. |
| `npe01__OppPayment__c` | → | folded into **GiftTransaction** | 🔜 | Combining a gift with its installments needs a many-into-one transform that isn't built yet. Payments stay unmapped for now. |
| `npe03__Recurring_Donation__c` | → | **GiftCommitment** | ⚠️ | The commitment migrates. Its **GiftCommitmentSchedule** child is 🔜 planned — recreate schedules in NPC for now. |
| `npsp__General_Accounting_Unit__c` | → | **GiftDesignation** | ✅ | The fund itself. |
| `npsp__Allocation__c` | → | **GiftTransactionDesignation** | ✅ | The gift-to-fund link, with amount and percent. |
| `npsp__Partial_Soft_Credit__c` | → | **GiftSoftCredit** | ✅ | Same idea, different object. |
| `npe5__Affiliation__c` | → | **AccountContactRelation** | ✅ | NPC uses "Contacts to Multiple Accounts" for person↔org. |
| `npe4__Relationship__c` | → | **ContactContactRelation** | ⚠️ | Migrates, but NPSP's auto-created reciprocal pairs aren't yet de-duplicated. |
| Organization `Account` | → | **Business Account** | 🔜 | Needs a Household-vs-Organization filter that isn't built yet. |
| `npsp__Level__c` | → | — | ❌ | No NPC equivalent exists. Decide per project: a custom field, or skip. |

Anything marked 🔜 or ⚠️ is tracked in
[planning_for_migration/04-roadmap.md](planning_for_migration/04-roadmap.md).

Curated translations start **enabled**; heuristic guesses start **disabled** until you review them —
see Step 4 below.

## Step 1 · Prepare the blank NPC org

If your NPC org is brand new, **do this before connecting it**. A fresh NPC org does not have
`GiftTransaction`, `GiftCommitment`, or `GiftDesignation` until an administrator turns on two things in
Setup:

1. **Person Accounts** — required for the Person Account model NPC uses.
2. **Nonprofit Cloud for Fundraising** — the feature that creates the Gift* objects this app maps
   donation data into.

> If you skip this step, Analyze will still run — but the Analysis Report will show a single clear
> warning ("target org doesn't appear to have Fundraising enabled") instead of a wall of confusing
> "object missing" rows, and link back to this section.

For the exact click-path (it changes as Salesforce updates NPC), follow Salesforce's own setup
documentation:
- [Set Up Nonprofit Cloud — Salesforce Help](https://help.salesforce.com/s/articleView?id=sfdo.npc_set_up_nonprofit_cloud_parent.htm&type=5)
- [Nonprofit Success Pack — Salesforce Help](https://help.salesforce.com/s/articleView?id=sfdo.nonprofit_success_pack.htm&type=5) (reference for what your source org has)

## Step 2 · Connect both orgs

On a project page, connect the **Source** (your existing NPSP org — this app never writes to it) and
the **Target** (your prepared NPC org). Each connection uses Salesforce's standard login + consent
screen — you're not sharing a password with this app, you're authorizing it the same way you'd
authorize any connected app.

After connecting, each org runs a quick **capability check** — it confirms things like whether NPSP is
actually installed on the source, and whether Person Accounts / Fundraising are enabled on the target.
Green checks are good; anything flagged is worth reading before you continue.

## Step 3 · Analyze & read the report

Analyze is read-only on both orgs. It discovers every object your source org actually has (not a fixed
list), captures full field detail (types, required/unique flags, picklist values, record types,
relationships), inspects validation rules and automations, checks whether your target org can receive
the data, and drafts a first-pass mapping. On a large org this can take a few minutes.

Once it finishes, open the **Analysis Report** from the project page. It has 8 sections:

- **Overview** — record counts, mapping counts, and a few org capability flags at a glance.
- **Warnings** — the most important section: every issue found, with a plain-language *why* and a
  concrete *what to do*. Blockers should be resolved before you continue; info items are just things
  worth knowing.
- **Source Object Inventory** — every object found in the NPSP org, with record counts.
- **Field Dictionary** — per-object field detail: type, required, unique, formula, picklist values.
- **Validation Rules & Automations** — business logic in the source org today. This app doesn't migrate
  automations, but you should know what exists so you can decide whether to recreate any of it in NPC.
- **NPSP Configuration** — key NPSP settings captured for reference.
- **Target Org Readiness** — every object in the target NPC org, not just the ones you've enabled.
  Objects a mapping targets show PASS/WARN/MISSING; everything else shows UNMAPPED (it exists, nothing
  currently targets it). Issues split into **in enabled mappings** (blocks migration now — fix first)
  and **in unreviewed drafts** (worth knowing, not urgent until enabled).
- **Mapping Summary** — every drafted mapping with its confidence level.

## Step 4 · Review the Mapping

Every drafted mapping has a confidence level:

- **curated** — a hand-built translation this app trusts; enabled by default.
- **heuristic** — a best guess based on matching names/fields; **starts disabled** until you review it.
- **unmapped** — no good target match was found; needs a target object picked manually.

Open the **Mapping Editor** to review drafts, pick target objects, map individual fields, and
enable/disable objects. Only *enabled* mappings run in Transform and Load — this is what makes
review-before-migrate safe.

**How to triage efficiently:** use the editor's **needs attention only** filter to jump straight to
mappings whose target is WARN or MISSING. Fix mappings you've already **enabled** first — those
actually block migration. Then work through unreviewed heuristic drafts flagged WARN/MISSING before
enabling them; a bad guess is fine to leave disabled.

Some objects need extra attention because — per the translation table above — they don't translate 1:1
and the app can't yet do the whole job:

- **Payments** (`npe01__OppPayment__c`) — should fold into their Opportunity's Gift Transaction. Not yet
  automated; leave unmapped and reconcile installments manually, or map them to separate gifts knowingly.
- **Recurring Donations** — the commitment migrates, but its **schedule** doesn't yet. Recreate
  schedules in NPC after Load.
- **Multi-member households** — each Contact becomes its own Person Account; the household grouping
  isn't rebuilt yet.
- **Relationships** — NPSP's reciprocal pairs both migrate, so expect duplicates to tidy.
- **Organization Accounts** — need a manual filter to avoid also copying Household Accounts.

Re-run Analyze anytime — your manual edits are preserved; only untouched auto-drafts get refreshed.

## Step 5 · Extract

Pulls every in-scope source object out of NPSP and into this app's own staging database, using
Salesforce's Bulk API — large objects are automatically split into chunks. This step only **reads**
from NPSP.

## Step 6 · Transform + Prepare Target

Applies your reviewed mapping to convert staged NPSP-shaped data into NPC-shaped data, and builds a
cross-reference table linking every old NPSP Id to where it will land in NPC (this is how relationships
stay intact even though every record gets a brand-new Id). **Prepare Target**, run from this stage,
creates one small tracking field on each target object in NPC — this is what makes Load safe to re-run
without creating duplicates.

## Step 7 · Load

Writes the transformed data into NPC, in dependency order (funds before gifts, accounts before
contacts, etc.) so relationships resolve correctly. Loading is **idempotent** — re-running it after
fixing an error updates existing records instead of creating duplicates, because of the tracking field
from Prepare Target.

## Step 8 · Validate

Reconciles what actually landed in NPC against what was staged — record counts and, where configured,
financial totals — and produces a downloadable report you can use to confirm the migration with
stakeholders.

## Glossary

| NPSP term | NPC term | What it is |
|---|---|---|
| `Account` (Household) + `Contact` | Person Account | An individual constituent |
| `Account` (Organization) | Business Account | A company/org constituent |
| `Opportunity` | GiftTransaction | A completed donation |
| `npe01__OppPayment__c` | (folded into GiftTransaction) | An installment payment on a donation |
| `npe03__Recurring_Donation__c` | GiftCommitment + GiftCommitmentSchedule | An ongoing pledge |
| `npsp__General_Accounting_Unit__c` | GiftDesignation | A fund/purpose |
| `npsp__Allocation__c` | GiftTransactionDesignation | A gift-to-fund link |
| `npsp__Partial_Soft_Credit__c` | GiftSoftCredit | Credit to a non-primary donor |
| `npe4__Relationship__c` | Contact Contact Relationship | Person-to-person link |
| `npe5__Affiliation__c` | Contacts to Multiple Accounts | Person-to-organization link |
| `Campaign` / `CampaignMember` | Campaign / CampaignMember | Same object in both — pass-through |

## Troubleshooting & FAQ

**Why does the Target Org Readiness table show (almost) everything as MISSING?**
This almost always means Nonprofit Cloud for Fundraising isn't enabled on the target org yet — see
[Step 1](#step-1--prepare-the-blank-npc-org) above. The Analysis Report's Warnings section calls this
out directly as a single blocker.

**Why does the readiness table have so many rows, and what does UNMAPPED mean?**
It covers the whole target org on purpose — every standard and custom object, not just the ones you've
mapped. UNMAPPED just means the object is real and exists in NPC, but nothing currently targets it —
that's normal for most of a large org and isn't something to fix. Use the **needs attention only**
filter (Mapping Editor) or filter box (Analysis Report) to skip past it straight to WARN/MISSING rows.

**Will re-running Analyze lose my mapping edits?**
No — mappings you've edited or approved are preserved. Only untouched auto-drafts get refreshed against
the latest schema.

**A stage failed partway through — do I have to start over?**
No. Every object within a stage tracks its own status; retry just the failed object from the stage's
panel instead of re-running the whole stage.

**Is it safe to re-run Load after fixing an error?**
Yes — Load is idempotent (see [Step 7](#step-7--load)). Re-running it never creates duplicate records.
