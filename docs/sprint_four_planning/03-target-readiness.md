# 03 · Target (NPC) Readiness Check

[← Analysis Report](02-analysis-report.md) · [Index](README.md) · Next: [Curation & Suggestions →](04-curation-and-suggestions.md)

---

## 1. Principle: the target is blank — check, don't audit

The NPC org is a **freshly created, empty org** with only its default standard schema. Deep-auditing
it (validation rules, flows, field dictionaries for 1000+ standard objects it ships with) buys almost
nothing for a migration *into* it. What matters is a single question:

> **Can this NPC org receive the data our enabled mappings produce?**

That is a **conformance/readiness** question: do the mapped target objects exist, and do the target
fields our mappings write to exist? This already exists in the codebase and works — Sprint 4 keeps it,
scopes it to the enabled mappings, and surfaces it in the report.

---

## 2. What already exists (keep it)

`discoverTargetSchema` (`packages/salesforce/src/discovery.ts:221-257`) already does exactly the right
thing:

- Fetches `describeGlobal()` once.
- For each expected target object: is it present? If yes, which expected fields are **missing**? If
  no, **suggest** similarly-named real objects (`findSimilarObjectNames`) **with their field lists**
  (`suggestionDetails`) so a human can pick the right one without leaving the report.
- Never throws per object, never auto-fixes — diagnostic only.

Analyze already calls it over the **enabled** mappings' targets
(`apps/worker/src/jobs/analyze.ts:135-160`) and writes PASS/WARN/MISSING outcomes into
`object_run.checkpoint`. **No change needed to the mechanism.**

We also already provision the target's write-side schema on demand: `prepareExternalIdFields`
ensures `Legacy_NPSP_Id__c` exists on each target object (`prepareTarget.ts`, `metadata.ts:34-60`) —
this stays a separate, explicit `POST /prepare-target` action (Transform-time), not part of Analyze.

---

## 3. What Sprint 4 adds

1. **Full target inventory stays** (`discoverAllObjects` → `target:`-prefixed object_runs) — it's the
   candidate pool the mapping editor's target picker uses. Keep the widened `FieldMeta` here too so
   the editor can show target field types/required flags when mapping.
2. **Surface readiness in the report.** The `AnalysisReport.targetReadiness[]` section
   ([02](02-analysis-report.md) §1) is populated directly from the target-check `object_run`
   checkpoints (`exists`, `missingFields`, `suggestions`, `outcome`). No new capture — just projection.
3. **Feed the `target-object-missing` blocker warning** ([02](02-analysis-report.md) §4) from any
   MISSING outcome on an **enabled** mapping. This is the actionable signal: "you enabled a mapping to
   an object the NPC org doesn't have — fix the mapping or the org before Load."

Explicitly **not** doing on the target: `captureOrgConfigAudit` (validation rules/flows/triggers). A
blank org has little, and none of it changes how we load. If a target org turns out non-blank in
practice, running the same audit on it is a trivial later toggle — the function is symmetric.

---

## 4. Report section (what the operator sees)

**Target Readiness (NPC)** table:

| Target Object | Outcome | Detail |
|---|---|---|
| `Account` | PASS | — |
| `GiftTransaction` | WARN | missing: `Legacy_NPSP_Id__c` (created at Prepare-Target) |
| `Designation` | MISSING | suggestions: `GiftDesignation`, `npsp__…` — with field lists to compare |

Plus, when the target org isn't connected yet, the section renders a clear "connect the target NPC org
and re-run Analyze to check readiness" note (Analyze already tolerates an unconnected target via its
try/catch, `analyze.ts:63-163`).
