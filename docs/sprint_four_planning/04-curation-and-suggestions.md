# 04 · Preserve Curation + Type/Picklist-Aware Suggestions

[← Target Readiness](03-target-readiness.md) · [Index](README.md) · Next: [Implementation Steps →](05-implementation-steps.md)

---

Two changes that make the **analyze → review → transform** loop trustworthy:

- **D. Preserve curation** — re-running Analyze must not destroy the operator's mapping edits.
- **E. Smarter drafts** — use the newly-captured picklist/required metadata to draft better and to
  warn about gaps.

---

## D. Preserve curation on re-Analyze

### D.1 The bug

`apps/worker/src/jobs/analyze.ts:108` deletes **all** mapping rows for the project, then re-creates
fresh drafts:

```ts
await prisma.mappingDefinition.deleteMany({ where: { projectId } });   // wipes hand edits too
```

Any target/field-map/enable edits the operator made in the Mapping Editor are gone the next time
Analyze runs. The `autoDrafted`, `approvedBy`, `approvedAt`, `version` columns exist precisely to
prevent this but are unused for preservation.

### D.2 The mechanism: mark user-owned rows, refresh only auto-drafts

**Signal:** a mapping is **user-owned** once the operator edits it. The editor's PATCH is the only way
edits happen, so mark ownership there.

1. **`apps/api/src/routes/mappings.ts` — PATCH sets `autoDrafted: false`.** Any user edit (target,
   fieldMap, or enabled) flips the row from auto-drafted to user-owned:

   ```ts
   const data: Prisma.MappingDefinitionUpdateInput = { autoDrafted: false }; // any edit => user-owned
   if (body.target !== undefined) data.target = body.target;
   if (body.fieldMap !== undefined) data.fieldMap = body.fieldMap as Prisma.InputJsonValue;
   if (body.enabled !== undefined) data.enabled = body.enabled;
   ```

   (Optional, nice-to-have: a `POST /projects/:id/mappings/:mappingId/approve` that sets
   `approvedBy`/`approvedAt` for an explicit sign-off, also treated as protected.)

2. **`analyze.ts` — preserve protected rows, re-seed only the rest.** Replace the blanket delete:

   ```ts
   // Load existing rows BEFORE re-drafting.
   const existing = await prisma.mappingDefinition.findMany({ where: { projectId } });
   const protectedRows = existing.filter((m) => m.autoDrafted === false || m.approvedAt !== null);
   const protectedSources = new Set(protectedRows.map((m) => m.object));

   // ... draft only for sources that are NOT protected ...
   const draftSources = sourceObjects.filter(
     (o) => (o.count > 0 || o.name in DEFAULT_MAPPINGS) && !protectedSources.has(o.name),
   );

   // Idempotent re-seed that KEEPS user work: delete only auto-drafted rows, recreate fresh drafts.
   await prisma.mappingDefinition.deleteMany({ where: { projectId, autoDrafted: true } });
   if (drafts.length > 0) {
     await prisma.mappingDefinition.createMany({ data: drafts.map((d) => draftToRow(projectId, d)) });
   }
   ```

**Result:** edited/approved mappings survive re-Analyze untouched; untouched auto-drafts are
refreshed against the latest schema; brand-new source objects still get drafted. The narrow
target-schema check should run over the union of protected-enabled + newly-drafted-enabled targets.

### D.3 Edge cases to handle

- **A protected mapping whose source object no longer exists** in the source org: keep the row but add
  an `unmapped-object-with-data`-style report warning (`source-object-removed`). Don't silently delete
  user work.
- **`version` bump (optional):** if you want an audit trail, increment `version` on protected rows at
  each Analyze rather than mutating in place. Not required for correctness; the `@@unique([projectId,
  object, version])` key already supports it. Keep v1 simple (mutate in place) unless you want history.

---

## E. Type/picklist-aware draft suggestions

Now that Analyze captures picklist values and required flags ([01](01-deep-metadata-capture.md)), the
drafter can do better than name/type matching.

### E.1 Widen the draft field shape

`packages/mapping/src/draft.ts` — `DraftFieldMeta` currently is `{ name, label, type }`. Add the
optional richer bits (kept optional so existing tests/data still compile):

```ts
export interface DraftFieldMeta {
  name: string; label: string; type: string;
  required?: boolean;
  picklistValues?: string[];   // value api names
}
```

And stop narrowing them away in `analyze.ts` — today it maps
`o.fields.map((fld) => ({ name, label, type }))` (`analyze.ts:97,102`), which throws the new data
back out. Pass `required` and `picklistValues` through so the drafter can see them.

### E.2 Picklist → value-map suggestions

In `draftFieldMap`, when a source field and its chosen target field are **both picklists**, emit a
`valueMap` suggestion by matching option values (exact, then case-insensitive):

```ts
// pseudo: after picking targetField for sourceField
if (isPicklist(sourceField) && isPicklist(targetField)) {
  const vm: Record<string, string> = {};
  for (const sv of sourceField.picklistValues ?? []) {
    const hit = (targetField.picklistValues ?? []).find(
      (tv) => tv === sv || tv.toLowerCase() === sv.toLowerCase(),
    );
    if (hit && hit !== sv) vm[sv] = hit;         // only when a translation is actually needed
  }
  if (Object.keys(vm).length) draft.valueMap[targetField.name] = vm;
}
```

The operator refines these in the editor; unmatched values are left for manual mapping (and can drive
a `picklist-value-unmatched` info warning).

### E.3 Required-target-field warnings

After building a draft's `fieldMap`, compute the **required** target fields that nothing maps to:

```ts
const mappedTargets = new Set(Object.values(draft.fieldMap));
const unmetRequired = targetObject.fields
  .filter((f) => f.required && !f.custom /* skip system/managed as needed */)
  .filter((f) => !mappedTargets.has(f.name))
  .map((f) => f.name);
```

Surface `unmetRequired` on the draft so [02](02-analysis-report.md) §4 can emit
`unmapped-required-target-field` warnings and the editor can badge them. This directly answers "will
this load actually succeed?" before Load runs.

### E.4 Tests

Extend `packages/mapping/src/draft.test.ts`:
- picklist→picklist with differing casing → produces a `valueMap`.
- picklist→picklist with identical values → **no** redundant `valueMap`.
- required target field left unmapped → appears in `unmetRequired`.
- non-picklist fields unaffected (regression guard on the existing 23 tests).

Keep `draft.ts` pure — all of this is unit-testable with in-memory fixtures, no Salesforce.
