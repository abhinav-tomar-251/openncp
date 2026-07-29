import type { Connection } from "jsforce";
import { countRecords } from "./schema.js";
import { DEFAULT_SOURCE_OBJECTS } from "./catalog.js";

/**
 * The Analyze stage's discovery primitives: instead of trusting a fixed object
 * list, ask each org what it actually has. See docs/04-migration-workflow.md
 * (Analyze) and the plan that introduced this file.
 */

/** Non-custom entries in the curated catalog — the "known standard objects" allowlist. */
const KNOWN_STANDARD_OBJECTS = new Set(
  DEFAULT_SOURCE_OBJECTS.filter((name) => !name.includes("__c")),
);

export interface PicklistValueMeta {
  value: string;
  label: string;
  active: boolean;
  default: boolean;
}

export interface FieldMeta {
  name: string;
  label: string;
  type: string;
  custom: boolean;
  /** Effectively required: not nillable and not auto-defaulted on create. */
  required: boolean;
  /** Writable on insert. Read-only rollups/formulas/autonumbers are createable=false —
   * a "required" field that isn't createable must NEVER be asked of the operator. */
  createable: boolean;
  /** Auto-number fields are system-generated; never mappable. */
  autoNumber: boolean;
  unique: boolean;
  externalId: boolean;
  /** Text length (0/undefined for non-text). */
  length?: number;
  /** Number precision/scale (for numeric types). */
  precision?: number;
  scale?: number;
  /** True for formula / roll-up-summary fields. */
  calculated: boolean;
  calculatedFormula?: string | null;
  /** Controlling field for dependent picklists. */
  controllerName?: string | null;
  dependentPicklist?: boolean;
  inlineHelpText?: string | null;
  /** Picklist options (undefined for non-picklist fields). */
  picklistValues?: PicklistValueMeta[];
  /** For reference/lookup fields: which object(s) it can point to. */
  referenceTo?: string[];
  relationshipName?: string | null;
}

export interface RecordTypeMeta {
  recordTypeId: string;
  name: string;
  /** The master (default) record type is always present even with none configured. */
  master: boolean;
  /** Available/active to the running user. */
  available: boolean;
}

export interface ChildRelationshipMeta {
  /** The child object that points back at this one. */
  childSObject: string;
  /** The lookup/master-detail field on the child that references this object. */
  field: string;
  relationshipName: string | null;
  cascadeDelete: boolean;
}

export interface DiscoveredSourceObject {
  name: string;
  label: string;
  custom: boolean;
  /** Hierarchy/list Custom Setting — configuration, NOT migratable data. Excluded
   * from mapping drafting and from "unmapped object with records" warnings; a
   * hierarchy setting always has exactly one org-default row. */
  customSetting: boolean;
  count: number;
  /** Complete field metadata — captured once so future mapping work can look up
   * "what does this object actually have" from already-known data instead of a
   * fresh live query each time. See docs/sprint_four_planning/01-deep-metadata-capture.md. */
  fields: FieldMeta[];
  /** Record types configured on the object (always includes the master). */
  recordTypes: RecordTypeMeta[];
  /** Objects that point at this one (the "children" side of the relationship graph). */
  childRelationships: ChildRelationshipMeta[];
}

/**
 * Is this target field one the operator must actually supply a value for?
 *
 * `required` alone is NOT sufficient: Salesforce reports read-only rollups
 * (`Campaign.NumberOfContacts`, `AmountWonOpportunities`), formulas, and
 * auto-number Name fields as non-nillable, but they are `createable: false` and
 * rejected on insert. Asking the operator to map them guarantees a Load failure.
 * Pure — used by both the readiness check and the analysis report's warnings.
 */
export function isMappableRequiredField(f: FieldMeta): boolean {
  return f.required && f.createable && !f.calculated && !f.autoNumber;
}

/**
 * Fields that look polymorphic but carry no donor/campaign meaning:
 * `OwnerId` is User|Group on EVERY object, and `SetupOwnerId` is
 * Organization|Profile|User on every hierarchy custom setting. Flagging them as
 * "won't stay linked to their donor" is pure noise (205 of 212 warnings in a real
 * org). Pure — used by the analysis report's polymorphic-lookup warning.
 */
export function isMeaningfulPolymorphicLookup(field: { name: string; referenceTo?: string[] }): boolean {
  if (field.name === "OwnerId" || field.name === "SetupOwnerId") return false;
  const refs = field.referenceTo ?? [];
  if (refs.length < 2) return false;
  // User|Group is the ownership pattern, not a business relationship.
  const ownerish = new Set(["User", "Group"]);
  return !refs.every((r) => ownerish.has(r));
}

/** NPSP managed-package namespaces — objects that belong to the NPSP data model. */
const NPSP_NAMESPACES = ["npsp__", "npe01__", "npe03__", "npe4__", "npe5__", "npo02__", "pmdm__"];

/**
 * Does this object belong to NPSP (or its Program Management Module)? Used to
 * draft mappings for the NPSP graph even when a sandbox has been scrubbed to zero
 * records — an empty-but-configured `npe03__Recurring_Donation__c` still needs its
 * NPSP→NPC translation surfaced for review. Pure.
 */
export function isNpspNamespacedObject(objectApiName: string): boolean {
  return NPSP_NAMESPACES.some((ns) => objectApiName.startsWith(ns));
}

/** Run async work over items with bounded concurrency (avoids hammering the API). */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

/** Salesforce auto-generates these companion objects for any object with the
 * corresponding feature enabled — never real, independently-meaningful objects. */
const SYSTEM_COMPANION_SUFFIXES = ["Feed", "History", "Share"];
function isSystemCompanionObject(name: string): boolean {
  return SYSTEM_COMPANION_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Build a complete inventory entry for a batch of candidate sobjects: record
 * count + full field metadata, fetched in parallel per object. This is the
 * "capture everything once" primitive both discovery functions share — future
 * mapping work reads from this captured data instead of re-querying Salesforce.
 */
async function buildInventory(
  conn: Connection,
  candidates: readonly { name: string; label: string; custom: boolean; customSetting?: boolean }[],
): Promise<DiscoveredSourceObject[]> {
  const emptyMeta = { fields: [] as FieldMeta[], recordTypes: [] as RecordTypeMeta[], childRelationships: [] as ChildRelationshipMeta[] };
  const built = await mapWithConcurrency(candidates, 8, async (s) => {
    const [count, meta] = await Promise.all([
      countRecords(conn, s.name).catch(() => {
        // Some queryable objects still reject COUNT() (e.g. certain platform
        // objects with special query restrictions) — treat as 0 rather than
        // fail the whole discovery pass over one object.
        return 0;
      }),
      conn
        .describe(s.name)
        .then((d) => ({
          // Keep the FULL richness describe() already returns (picklists, required,
          // formula, controlling field, external-id, record types, child relationships)
          // — previously discarded. No extra API call. See sprint_four_planning/01.
          fields: d.fields.map((f): FieldMeta => ({
            name: f.name,
            label: f.label,
            type: f.type,
            custom: f.custom,
            required: !f.nillable && !f.defaultedOnCreate,
            createable: !!f.createable,
            autoNumber: !!f.autoNumber,
            unique: !!f.unique,
            externalId: !!f.externalId,
            length: f.length || undefined,
            precision: f.precision || undefined,
            scale: f.scale || undefined,
            calculated: !!f.calculated,
            calculatedFormula: f.calculatedFormula ?? null,
            controllerName: f.controllerName ?? null,
            dependentPicklist: !!f.dependentPicklist,
            inlineHelpText: f.inlineHelpText ?? null,
            picklistValues: f.picklistValues?.length
              ? f.picklistValues.map((p): PicklistValueMeta => ({
                  value: String(p?.value ?? ""),
                  label: String(p?.label ?? p?.value ?? ""),
                  active: p?.active !== false,
                  default: !!p?.defaultValue,
                }))
              : undefined,
            referenceTo: f.referenceTo?.length ? f.referenceTo : undefined,
            relationshipName: f.relationshipName ?? null,
          })),
          recordTypes: (d.recordTypeInfos ?? []).map((rt): RecordTypeMeta => ({
            recordTypeId: rt.recordTypeId,
            name: rt.name,
            master: !!rt.master,
            available: !!rt.available,
          })),
          childRelationships: (d.childRelationships ?? []).map((c): ChildRelationshipMeta => ({
            childSObject: c.childSObject,
            field: c.field,
            relationshipName: c.relationshipName ?? null,
            cascadeDelete: !!c.cascadeDelete,
          })),
        }))
        .catch(() => emptyMeta),
    ]);
    return { name: s.name, label: s.label, custom: s.custom, customSetting: !!s.customSetting, count, ...meta };
  });
  return built.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Discover every object actually present in the source org that's worth
 * considering for extraction: the curated standard-object allowlist, PLUS every
 * custom object (`__c` suffix) regardless of namespace — this is what guarantees
 * NPSP managed-package objects *and* genuinely bespoke org-specific customizations
 * are found without ever needing to be hardcoded. Read-only (describe + COUNT()).
 */
export async function discoverSourceObjects(conn: Connection): Promise<DiscoveredSourceObject[]> {
  const global = await conn.describeGlobal();
  const candidates = global.sobjects.filter(
    (s) => s.queryable && (KNOWN_STANDARD_OBJECTS.has(s.name) || s.name.endsWith("__c")),
  );
  return buildInventory(conn, candidates);
}

/**
 * Full, unfiltered inventory of every queryable object in an org — no curated
 * allowlist. Unlike the source NPSP org (a known quantity we can curate a list
 * for), a target NPC org's real standard-object names are exactly what we don't
 * know ahead of time, so there's no allowlist to apply — everything queryable is
 * a candidate. Excludes only clear noise: Salesforce's auto-generated
 * Feed/History/Share companions, Custom Metadata Types (`__mdt`, configuration
 * not data), and Platform Events (`__e`, not persisted/countable).
 */
export async function discoverAllObjects(conn: Connection): Promise<DiscoveredSourceObject[]> {
  const global = await conn.describeGlobal();
  const candidates = global.sobjects.filter(
    (s) =>
      s.queryable &&
      !isSystemCompanionObject(s.name) &&
      !s.name.endsWith("__mdt") &&
      !s.name.endsWith("__e"),
  );
  return buildInventory(conn, candidates);
}

export interface SuggestionDetail {
  name: string;
  /** Field API names, custom fields first, noisy housekeeping fields filtered out. */
  fields: string[];
}

export interface TargetSchemaCheck {
  name: string;
  exists: boolean;
  missingFields: string[];
  /** Candidate real object names when `exists` is false — see findSimilarObjectNames. */
  suggestions: string[];
  /** Field lists for each suggestion, so a human can compare without leaving the report. */
  suggestionDetails: SuggestionDetail[];
}

/** Standard fields present on nearly every object — filtered out because they never
 * help distinguish *which* object is the right one (see summarizeFields). */
const HOUSEKEEPING_FIELDS = new Set([
  "Id",
  "OwnerId",
  "IsDeleted",
  "CreatedDate",
  "CreatedById",
  "LastModifiedDate",
  "LastModifiedById",
  "SystemModstamp",
  "LastActivityDate",
  "LastViewedDate",
  "LastReferencedDate",
]);

/**
 * Reduce a describe() field list to the fields actually useful for a human to eye
 * up "is this the right object" — custom fields first (most likely to reveal
 * business purpose), housekeeping fields dropped entirely. Pure, unit-testable.
 */
export function summarizeFields(fields: readonly { name: string; custom: boolean }[]): string[] {
  const custom = fields.filter((f) => f.custom).map((f) => f.name).sort();
  const standard = fields
    .filter((f) => !f.custom && !HOUSEKEEPING_FIELDS.has(f.name))
    .map((f) => f.name)
    .sort();
  return [...custom, ...standard];
}

export interface DescribedObjectRef {
  name: string;
  label: string;
}

/**
 * Find sobjects whose name/label looks related to `target` — a case-insensitive
 * substring match in either direction (catches e.g. "Designation" matching
 * "GiftDesignation" or "npsp__Designation__c"). Pure and side-effect-free, so it's
 * cheaply unit-testable independent of the live describeGlobal() call in
 * discoverTargetSchema. Not a guess at the *correct* name — a shortlist of real
 * candidates from the org's actual schema for a human to confirm.
 */
export function findSimilarObjectNames(
  target: string,
  candidates: readonly DescribedObjectRef[],
  limit = 5,
): string[] {
  const t = target.toLowerCase();
  const matches = candidates.filter((c) => {
    if (isSystemCompanionObject(c.name)) return false;
    const name = c.name.toLowerCase();
    const label = c.label.toLowerCase();
    return name.includes(t) || label.includes(t) || t.includes(name) || t.includes(label);
  });
  return matches.slice(0, limit).map((c) => c.name);
}

/**
 * Pure, in-memory equivalent of `discoverTargetSchema` — no `Connection`, no API
 * calls. Reads from an inventory already fetched this Analyze run (e.g.
 * `discoverAllObjects`'s result) instead of live `describe()` calls, so it's free
 * to run over every mapped target object instead of a narrow enabled-only subset.
 * See docs/sprint_four_planning (target readiness) and the plan that widened this
 * check to cover every drafted mapping, not just currently-enabled ones.
 */
export function checkTargetSchema(
  inventory: readonly Pick<DiscoveredSourceObject, "name" | "label" | "fields">[],
  targetObjects: readonly string[],
  fieldsForObject: (targetObject: string) => string[],
): TargetSchemaCheck[] {
  const byName = new Map(inventory.map((o) => [o.name, o]));
  const candidates: DescribedObjectRef[] = inventory.map((o) => ({ name: o.name, label: o.label }));

  return targetObjects.map((name) => {
    const obj = byName.get(name);
    if (!obj) {
      // Referenced by a mapping but not found in the target org's real inventory
      // (e.g. the feature that creates it isn't enabled, or the name is stale).
      const suggestions = findSimilarObjectNames(name, candidates);
      const suggestionDetails: SuggestionDetail[] = suggestions.map((sName) => {
        const s = byName.get(sName);
        return { name: sName, fields: s ? summarizeFields(s.fields) : [] };
      });
      return { name, exists: false, missingFields: [], suggestions, suggestionDetails };
    }
    const present = new Set(obj.fields.map((f) => f.name));
    const expected = fieldsForObject(name);
    const missingFields = expected.filter((f) => !present.has(f));
    return { name, exists: true, missingFields, suggestions: [], suggestionDetails: [] };
  });
}

/**
 * Confirm the target org's actual schema for each object our mappings write to,
 * against the field names our mapping definitions assume. Diagnostic only — never
 * throws per-object, and never auto-fixes anything; see the "Scope boundaries" in
 * the plan that introduced this. `fieldsForObject` supplies the expected field
 * list per target object (injected so this package doesn't depend on @opennpc/mapping).
 *
 * Fetches describeGlobal() once and reuses it both to check existence and — when
 * an object is missing — to suggest similarly-named real objects, at no extra
 * API-call cost.
 */
export async function discoverTargetSchema(
  conn: Connection,
  targetObjects: readonly string[],
  fieldsForObject: (targetObject: string) => string[],
): Promise<TargetSchemaCheck[]> {
  const global = await conn.describeGlobal();
  const queryableObjects = global.sobjects.filter((s) => s.queryable);
  const presentNames = new Set(queryableObjects.map((s) => s.name));

  return mapWithConcurrency(targetObjects, 4, async (name) => {
    if (!presentNames.has(name)) {
      const suggestions = findSimilarObjectNames(name, queryableObjects);
      // Fetch each candidate's fields too, so a human can compare real schemas
      // right in the report instead of guessing from object names alone.
      const suggestionDetails = await mapWithConcurrency(suggestions, 3, async (sName) => {
        try {
          const desc = await conn.describe(sName);
          return { name: sName, fields: summarizeFields(desc.fields) };
        } catch {
          return { name: sName, fields: [] };
        }
      });
      return { name, exists: false, missingFields: [], suggestions, suggestionDetails };
    }
    try {
      const desc = await conn.describe(name);
      const present = new Set(desc.fields.map((f) => f.name));
      const expected = fieldsForObject(name);
      const missingFields = expected.filter((f) => !present.has(f));
      return { name, exists: true, missingFields, suggestions: [], suggestionDetails: [] };
    } catch {
      // Listed in describeGlobal but describe() itself failed (rare) — treat as
      // missing rather than throwing, consistent with the rest of this function.
      return { name, exists: false, missingFields: [], suggestions: [], suggestionDetails: [] };
    }
  });
}
