import { LEGACY_EXTERNAL_ID_FIELD, type MappingDefinition } from "./index.js";

export interface TransformResult {
  targetObject: string;
  sourceId: string;
  /** NPC-shaped record, incl. Legacy_NPSP_Id__c and relationship-by-external-id keys. */
  record: Record<string, unknown>;
}

/**
 * Apply a mapping definition to one raw source record, producing an NPC-shaped
 * target record. Pure and deterministic given the same (raw, def, overrides).
 *
 * Lookups are emitted as `RelationshipName.Legacy_NPSP_Id__c = <source parent id>`
 * so Bulk API 2.0 upsert can resolve the relationship by external id at load time,
 * without needing the target parent's new Salesforce Id. Returns null if the
 * record is filtered out. See docs/08-transformation-engine.md.
 *
 * `overrides` lets the caller inject values resolved from the live target org that
 * a static mapping definition can't express — e.g. a dynamically-discovered
 * RecordTypeId, or a per-row OwnerId resolved via the User id_xref. Overrides win
 * over fieldMap/constants for the same target field.
 */
export function applyMapping(
  raw: Record<string, unknown>,
  def: MappingDefinition,
  overrides?: Record<string, unknown>,
): TransformResult | null {
  if (def.filter && !def.filter(raw)) return null;

  const sourceId = String(raw.Id ?? raw.id ?? "");
  const record: Record<string, unknown> = {};

  // Static constants first (may be overridden by mapped fields).
  for (const [field, value] of Object.entries(def.constants ?? {})) {
    record[field] = value;
  }

  // Scalar field map, with optional per-field value translation.
  for (const [srcField, tgtField] of Object.entries(def.fieldMap)) {
    let value = raw[srcField];
    if (value === undefined || value === null || value === "") continue;
    const vm = def.valueMap?.[srcField];
    if (vm) {
      const key = String(value);
      if (key in vm) value = vm[key];
    }
    record[tgtField] = value;
  }

  // Lookups: relationship-by-external-id.
  for (const [srcIdField, lookup] of Object.entries(def.lookups ?? {})) {
    const parentSourceId = raw[srcIdField];
    if (parentSourceId === undefined || parentSourceId === null || parentSourceId === "") continue;
    const extIdField = lookup.externalIdField ?? LEGACY_EXTERNAL_ID_FIELD;
    record[`${lookup.relationship}.${extIdField}`] = String(parentSourceId);
  }

  // Caller-supplied overrides (e.g. resolved RecordTypeId, remapped OwnerId).
  for (const [field, value] of Object.entries(overrides ?? {})) {
    if (value !== undefined && value !== null) record[field] = value;
  }

  // External id that makes the load idempotent and links back to the source.
  record[LEGACY_EXTERNAL_ID_FIELD] = sourceId;

  return { targetObject: def.target, sourceId, record };
}
