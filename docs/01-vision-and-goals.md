# 01 · Vision & Goals

[← Back to index](README.md) · Next: [Scope & Personas →](02-scope-and-personas.md)

---

## 1. Executive summary

**OpenNPC Migration Platform** is a free, open-source framework that automates migrating a Salesforce
**Nonprofit Success Pack (NPSP)** organization into a Salesforce **Nonprofit Cloud (NPC)**
organization.

Unlike ad-hoc migration scripts or consulting-led projects, OpenNPC offers an **interactive, guided,
restartable** migration experience. It connects to both orgs via OAuth, analyzes the source,
extracts data, transforms it into the NPC data model, prepares the target org's schema, loads the
data while preserving relationships, validates the result, and produces a full migration report.

It is modular, configuration-driven, and community-extensible. The migration is expressed as a
**durable state machine**, not a fragile linear wizard — so a failure at record 280,000 of 300,000
never forces you to start over.

## 2. Vision

To become the **standard open-source migration framework** for Salesforce nonprofit organizations —
so that moving from NPSP to Nonprofit Cloud is a transparent, auditable, repeatable engineering
process rather than an expensive, opaque, one-off consulting engagement.

## 3. Mission

Provide a completely free, transparent, reliable, and extensible platform that lets organizations
migrate from NPSP to NPC with minimal manual effort while retaining full visibility and control over
every step.

## 4. Problem statement

Migrating NPSP → NPC is today largely manual and error-prone because:

- The data models differ fundamentally (managed-package custom objects + Household Accounts vs.
  standard objects + Person Accounts / Party model).
- Every record's Salesforce ID changes in the target org, so **all relationships must be rebuilt**.
- Donations + Payments collapse into Gift Transactions; Recurring Donations become Gift Commitments;
  General Accounting Units become Designations — each needing real transformation logic, not a copy.
- High-volume orgs (hundreds of thousands of records) require long-running, resumable batch jobs.
- There is **no comprehensive open-source tool** that automates this end-to-end with proper
  recovery, review, and auditability.

## 5. Goals

The platform should:

- Connect securely to a source and a target Salesforce org.
- Analyze the source org **before** any migration (schema, volumes, customizations, NPSP config).
- Extract supported data via Bulk API 2.0 into durable staging.
- Transform NPSP objects into their NPC equivalents using editable, versioned mappings.
- Prepare the target org's schema (external-ID fields, record types, picklist values).
- Load data while preserving relationships, idempotently (safe to re-run).
- Validate migration accuracy (counts, financial totals, relationships).
- Produce detailed, exportable migration reports.
- Allow each stage to be **paused, reviewed, resumed, and re-run independently**.
- Support community-developed mapping plugins.
- Remain fully open source and self-hostable with Docker.

## 6. Non-goals

The platform will **not**:

- Replace Salesforce Data Loader or the Salesforce CLI for general-purpose use.
- **Modify the source org** — all source operations are strictly read-only.
- Deploy NPSP's managed-package metadata (objects/flows/Apex) into NPC. (NPC has a different data
  model; we *prepare* the target schema, we do not clone NPSP's.)
- Auto-translate arbitrary Apex/Flow business logic into NPC equivalents.
- Guarantee 100% hands-off migration for heavily customized orgs — business-specific mapping
  decisions are always required.
- Support every managed package on day one.

## 7. Guiding principles

- **Transparency** — every step is visible and logged; no hidden "black box" processing.
- **Restartability** — operations are resumable; a failure never requires restarting the whole
  migration. Each stage and each object within a stage tracks its own status.
- **Source safety** — the source org is treated as strictly read-only at all times.
- **Repeatability** — the same inputs produce the same outputs; loads are idempotent via external IDs.
- **Configuration over code** — mappings and rules live in editable definition files, not hardcoded
  logic, so the tool survives NPC schema changes and org customizations.
- **Open-source first** — designed for community contribution and extension from the start.

## 8. Success criteria

The project is successful when it can:

- Connect to two Salesforce orgs and complete the full 5-stage workflow.
- Preserve all supported relationships through the ID cross-reference.
- Produce validation/reconciliation reports proving record counts and financial totals match.
- Resume a failed migration without duplicating data.
- Support custom field/object mappings through configuration or plugins.
- Be deployed via Docker and started with a single command.

## 9. High-level workflow

Five stages, each independently executable and restartable:

1. **Analyze** (connect + assess)
2. **Extract**
3. **Transform** (+ prepare target schema)
4. **Load**
5. **Validate**

Details in [04-migration-workflow.md](04-migration-workflow.md).

## 10. Product philosophy

OpenNPC is intentionally **not** a one-click black box. It is a *guided* migration: the user
understands each stage, reviews the important outputs (mapping draft, transformed samples, load
errors, reconciliation), and stays in control. Automation reduces manual effort **without** taking
away transparency or trust — which is exactly what a finance-sensitive nonprofit migration requires.
