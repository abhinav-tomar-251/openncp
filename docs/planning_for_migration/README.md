# Planning for Migration — NPSP → NPC Completeness Program

> **What this folder is.** The working plan for taking OpenNPC from "a working pipeline that migrates
> a thin slice" to "a complete NPSP → NPC migration product". Unlike `docs/01–18` (which describe the
> *intended* product, written before/early in the build), everything here is **grounded in evidence**:
> a real 282-object NPSP org, a real 1,074-object NPC org, Salesforce's own NPC object reference, and
> a line-by-line audit of what the code actually does today.

---

## Read in this order

| # | Document | What it answers |
|---|----------|-----------------|
| 00 | [Gap Analysis](00-gap-analysis.md) | What's promised vs what's built vs what a real org needs. The 13 concrete defects, with evidence. |
| 01 | [NPSP ↔ NPC Object Map](01-npsp-npc-object-map.md) | **The authoritative mapping spec.** Every NPSP object → its verified NPC target, cardinality, fields, lookups. |
| 02 | [Engine Architecture](02-engine-architecture.md) | Why 1→N and N→1 transforms are impossible today, and the design that unlocks them. |
| 03 | [Automation & Guidance](03-automation-and-guidance.md) | The hybrid model: what auto-runs, what asks the operator, and how the guided path works. |
| 04 | [Roadmap](04-roadmap.md) | Phases 1–5 with acceptance criteria. |
| 05 | [Verification Plan](05-verification-plan.md) | How each phase is proven against the real org. |

---

## Where the product stands (2026-07-28)

**Works end-to-end today:** OAuth for both orgs · full-org schema discovery + org-config audit ·
whole-org Bulk 2.0 extract into Postgres · per-record field mapping with picklist translation and
external-id lookups · DB-backed editable mappings with curated/heuristic confidence, preserved across
re-Analyze · external-id field provisioning · dependency-ordered idempotent Bulk 2.0 upsert · count/sum
reconciliation · a full analysis report (in-app + Markdown/JSON) and an operator guide.

**Phase 1 (this pass) additionally delivered:**
- The NPSP transactional graph now has **curated mappings**: GAU→`GiftDesignation`,
  Allocation→`GiftTransactionDesignation`, Partial Soft Credit→`GiftSoftCredit`,
  Recurring Donation→`GiftCommitment`, Affiliation→`AccountContactRelation`,
  Relationship→`ContactContactRelation`.
- **Gifts are no longer orphaned** — `Opportunity` now carries a donor lookup to the Person Account.
- **13 correctness/noise defects fixed** (see [00-gap-analysis.md](00-gap-analysis.md)).

**Still missing — the honest list:**
- **Cardinality.** The engine cannot emit more than one record per source row, nor merge many rows into
  one. This blocks: Opportunity+Payments → one GiftTransaction, RD → Commitment **+ Schedule**,
  Household → Person Account **+ PartyRelationshipGroup**, Address → ContactPoint*.
- **Record-level filters** can't be persisted, so "only migrate Closed Won" or "dedupe reciprocal
  relationships" isn't expressible.
- **Validate** compares staged-vs-live, not source-vs-target, and checks no relationship integrity.
- **Programs/PMM, Engagement Plans, Levels, Addresses, files** are unmapped.

See [04-roadmap.md](04-roadmap.md) for how those close.

---

## Relationship to `docs/01–18`

`docs/01–17` are the original PRD (June) and were **never revised** as the build progressed, so several
of their claims are now known to be wrong against a real NPC org (e.g. `Designation`, `GivingTier`,
`PartyRelationshipGroupMember` do not exist). `docs/05-data-model-mapping.md` and
`docs/18-migration-guide-for-operators.md` were corrected in this pass; where those docs and this folder
disagree, **this folder wins** — it is the evidence-based one.
