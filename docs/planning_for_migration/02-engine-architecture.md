# 02 · Engine Architecture — unlocking structural transforms

[← Object Map](01-npsp-npc-object-map.md) · [Index](README.md) · Next: [Automation & Guidance →](03-automation-and-guidance.md)

---

## The constraint, precisely

`applyMapping` (`packages/mapping/src/engine.ts`) is a **pure per-record renamer**:

```ts
export function applyMapping(
  raw: Record<string, unknown>,
  def: MappingDefinition,
  overrides?: Record<string, unknown>,
): TransformResult | null            // ← singular, and def.target is one string
```

It can rename fields, translate picklist values, emit external-id relationship keys, apply constants
and caller overrides, and drop a record. It **cannot**:

| Missing capability | Consequence |
|---|---|
| return more than one record | no `GiftCommitmentSchedule` beside its `GiftCommitment`; no `ContactPointAddress` beside a Person Account |
| write to more than one target object | no Household → Person Account **+** `PartyRelationshipGroup` |
| see any record other than `raw` | no Opportunity+Payments merge; no household-members roll-up |
| express a computed value | no concat, no date math, no default-when-blank |
| persist a `filter` | no "Closed Won only", no reciprocal-relationship dedup, no Household-vs-Org account split |

Three independent limits — cardinality, context, and expression — plus one hard database constraint.

## The database blocker

```prisma
model IdXref { ... @@unique([projectId, sourceId]) }   // schema.prisma
```

One source Id may appear **exactly once** in the whole cross-reference table. A Contact that produces
both a Person Account *and* a party-group membership cannot be represented. `load.ts` compounds it by
updating the xref on `sourceId` alone with no `targetObject` filter, so a second row would be clobbered.

**Any 1→N transform is impossible until this changes.**

---

## Phase 2 — cardinality and expression

### 2.1 Multi-record emit

```ts
export function applyMapping(...): TransformResult[]        // was: TransformResult | null
```

An empty array replaces `null`. `MappingDefinition` gains an optional child-emit list:

```ts
interface MappingDefinition {
  // …existing…
  /** Additional records emitted from the SAME source row, e.g. a commitment's schedule. */
  emits?: EmittedRecord[];
}
interface EmittedRecord {
  target: string;                      // e.g. "GiftCommitmentSchedule"
  fieldMap: Record<string, string>;
  valueMap?: Record<string, Record<string, string>>;
  constants?: Record<string, unknown>;
  /** Relationship back to the primary record, resolved by external id. */
  parentRelationship: string;          // e.g. "GiftCommitment"
  /** Skip this child when the predicate is false (see 2.3). */
  when?: SerializedPredicate;
}
```

The parent's `Legacy_NPSP_Id__c` is reused as the child's parent key, so children resolve through the
same external-id upsert mechanism already in use — no new load machinery.

**Unlocks:** RD → Commitment **+ Schedule** · Address → ContactPoint* · tributes → `GiftTribute`.

### 2.2 `id_xref` schema change *(requires one `pnpm db:push`)*

```prisma
model IdXref {
  // …
  @@unique([projectId, sourceObject, sourceId, targetObject])   // was ([projectId, sourceId])
  @@index([projectId, sourceId])
}
```

and `load.ts` must scope its write-back by `targetObject` as well as `sourceId`. Batch this with any
other pending schema change into a single push.

### 2.3 Persistable filters

`filter?: (raw) => boolean` is a JS function, so it is silently dropped when a mapping round-trips
through the database (`rowToMappingDefinition` reconstructs everything *except* the filter). Replace it
with a small serializable predicate stored in the row's `options` JSON:

```ts
type SerializedPredicate =
  | { field: string; op: "eq" | "ne" | "in" | "notIn" | "isNull" | "notNull"; value?: unknown }
  | { all: SerializedPredicate[] }
  | { any: SerializedPredicate[] };
```

A pure `evaluatePredicate(pred, raw)` keeps it unit-testable and safe (no `eval`).

**Unlocks:** Household-vs-Organization account split · Closed-Won-only gifts · reciprocal-relationship
dedup · primary-vs-soft-credit `OpportunityContactRole` split.

### 2.4 Mapping Editor API coverage

`PATCH /projects/:id/mappings/:mappingId` accepts only `target`, `fieldMap`, `enabled` today — so an
operator literally cannot add a missing relationship through the UI. Extend it to `lookups`,
`valueMap`, `constants`, and `filter`, with the same "any edit marks the row user-owned" semantics.

---

## Phase 3 — merge/reduce and the structural modules

### 3.1 Key-aware batching

`runTransformObject` pages `staging_source` 1,000 rows at a time. A merge group (all Payments for one
Opportunity) can straddle a page boundary, so merge cannot be bolted onto the existing loop. Merge-mode
mappings instead:

1. select the **merge key** column,
2. page ordered by that key,
3. flush a group only once the key changes (a "sorted-run reduce"),

which keeps memory bounded without loading the object whole.

### 3.2 Structural transform module contract

```ts
type StructuralTransform = (
  sourceRecords: Record<string, unknown>[],   // one merge group, or one row for fan-out
  ctx: TransformContext,                      // id_xref lookups, mapping def, project options
) => TransformResult[];
```

Pure and unit-testable, matching `docs/08 §3`. Registered by name so a mapping row can reference one.

### 3.3 The six modules

| Module | Shape | Notes |
|---|---|---|
| Household → Person Account | N→1 + 1→N | gated on `npe01__Account_Processor__c`; needs a primary-contact rule |
| Opportunity + Payments → GiftTransaction | N→1 | `paymentSplit`: installments \| separate gifts |
| RD → Commitment + Schedule | 1→N | normalizes classic RD1 vs Enhanced RD2 |
| Allocation → designation | 1:1 conditional | `GiftTransactionDesignation` vs `GiftDefaultDesignation` |
| Soft credits / tributes | 1→N | from `OpportunityContactRole` + tribute fields |
| Owner remap | override | already implemented via `overrides` |

---

## Phase 4 — load & validate depth

- **Dynamic load order** derived from each mapping's own lookups (topological sort) rather than the
  static `TARGET_LOAD_ORDER`; unlisted custom objects currently all collapse to one index and load in
  arbitrary order.
- **Second pass** for circular/self references (`Campaign.ParentId`, reciprocal relationships).
- **Polymorphic lookups** (`WhoId`/`WhatId`, `CampaignMember.LeadOrContactId`) — resolve the concrete
  type from the source Id prefix, then emit the right typed relationship.
- **Validate depth:** source→target reconciliation (not just staged→live), allocation balancing
  (designations sum to the gift), relationship integrity, orphan/duplicate detection, rollup trigger.

---

## Sequencing rationale

Phase 2 is deliberately first and small: multi-record emit plus the `id_xref` key plus persistable
filters are three self-contained changes that between them unblock **five** of the missing translations
without touching the batching model. Phase 3's merge work is the genuinely invasive part and benefits
from Phase 2's emit path already being proven in production.
