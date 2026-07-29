# 06 · Verification

[← Implementation Steps](05-implementation-steps.md) · [Index](README.md)

---

## 1. Static checks (after each step, and once at the end)

```bash
pnpm -r run typecheck     # all 7 packages clean
pnpm -r run test          # existing 25 (23 mapping + 2 api) stay green,
                          # plus new orgAudit / draft / analysisReport tests
```

Prisma client after the schema change: `pnpm --filter @opennpc/db run generate` (avoids the
postinstall stub race that produced implicit-any errors before).

---

## 2. Your one-time setup (local)

```bash
pnpm db:push                 # adds StageRun.audit (nullable) — no data loss
# restart worker + web
```

I never run these against your DB — you do.

---

## 3. Live end-to-end (the real proof)

With the **source NPSP** connected and a **fresh blank NPC** connected:

1. **Run Analyze.** Then inspect the DB (your `postgresql://postgres:admin@localhost:5432/opennpc`):
   - A source `object_run.checkpoint` now contains **widened** fields — e.g. a picklist field shows
     `picklistValues`, a required field shows `required: true`, a formula shows `calculatedFormula`;
     the object shows `recordTypes` and `childRelationships`.
   - `stage_run.audit` (latest analyze row) is populated: `audit.source.validationRules`,
     `.flows`, `.apexTriggers`, `.tdtmHandlers`, `.npspSettings`, and a `captured`/`skipped` list.

2. **Fetch the report:**
   ```bash
   # JSON for the UI
   curl -s --cookie "<session>" http://localhost:3001/projects/<id>/analysis | jq '.source.objectCount, .mappings, (.warnings|length)'
   # Markdown document
   curl -s --cookie "<session>" "http://localhost:3001/projects/<id>/analysis?format=md" -o npsp-analysis.md
   ```
   `npsp-analysis.md` should be a complete, readable document: overview, warnings, object inventory,
   per-object field dictionary, relationships, validation rules & automations, NPSP config, target
   readiness, mapping summary.

3. **Report page:** open `/projects/<id>/analysis` in the web UI. Every section renders; expanding an
   object row shows its field dictionary; **Download Markdown** and **Download JSON** work; the mapping
   summary links into the Mapping Editor.

4. **Warnings are meaningful:** confirm you see e.g. `unmapped-object-with-data` for a populated but
   unmapped NPSP object, and `target-object-missing` (blocker) if an enabled mapping points at an
   object the blank NPC lacks.

5. **Curation survives re-Analyze (the key regression test):**
   - In the Mapping Editor, edit a mapping (set a target / add a field / enable it) — this flips
     `autoDrafted=false`.
   - **Re-run Analyze.**
   - Confirm the edited mapping is **unchanged** (target/fieldMap/enabled preserved), while an
     untouched auto-drafted mapping was refreshed. Before this sprint, the edit would have been wiped.

6. **Smarter drafts:** for a source picklist field mapped to a target picklist with differing casing,
   the draft carries a `valueMap`; a required target field with no source mapping shows up as an
   `unmapped-required-target-field` warning.

---

## 4. No-regression checklist

- Transform/Load still produce the same curated objects (mappings still drive the pipeline via
  `loadProjectMappings`).
- `GET /stages/analyze` still returns the **lightweight** payload (fields stripped to `fieldCount`) —
  only `/analysis` surfaces the full data. (Prevents a huge payload on the existing panel.)
- Analyze still tolerates an **unconnected target** (target section shows the "connect NPC" note).
- All config-audit kinds fail **soft**: an org with no NPSP / no workflow rules / a locked-down
  Tooling API still completes Analyze, with those kinds listed under `skipped`.

---

## 5. Known deferred (NOT in this sprint — candidates for Sprint 5)

From the architecture audit, real but intentionally out of scope now:

- **Partial-parent orphan risk:** Load treats `PARTIAL` as success and chains children; children whose
  parent failed can't resolve their external-id lookup. (`load.ts:150-153`)
- **Hardcoded `TARGET_LOAD_ORDER`:** auto-drafted custom targets load last regardless of true
  dependency. (`defaults.ts:165-175`)
- **Polymorphic lookups dropped:** Task/Event `WhoId`/`WhatId` not re-linked. (`defaults.ts:97-114`)
- **No FLS grant** after creating `Legacy_NPSP_Id__c` (`metadata.ts:47-59`) — upsert can fail on field
  visibility in some orgs.
- **O(n²) OFFSET pagination** in transform/load on large objects.
- **User matching capped at 2000, unpaginated** (`userXref.ts:47-51`).
- **`filter` predicates not serialized** through `mapping_definition` (latent; no current default uses
  one).

These are documented here so they're not forgotten — none blocks the Sprint 4 analysis/report goal.
