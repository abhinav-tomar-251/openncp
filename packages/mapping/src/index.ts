/**
 * @opennpc/mapping — the transformation engine and default NPSP -> NPC mappings.
 *
 * Foundation stub (Milestone 1): defines the mapping-definition shape so the rest
 * of the system can type against it. The engine and default YAML mappings land in
 * Milestone 7. See docs/08-transformation-engine.md.
 */

/** A field map entry: a plain copy, or a lookup re-pointed through id_xref. */
export type FieldMapValue = string | { ref: string; via: "id_xref" };

export interface MappingDefinition {
  /** Source object API name, e.g. "Opportunity". */
  source: string;
  /** Target object API name, e.g. "GiftTransaction". */
  target: string;
  /** Source field -> target field (or lookup ref). */
  fieldMap: Record<string, FieldMapValue>;
  /** Per-field value translation (picklists, stages, record types). */
  valueMap?: Record<string, Record<string, string>>;
  /** Record type translation. */
  recordTypeMap?: Record<string, string>;
  /** Per-object transform options, e.g. { paymentSplit: "installments" }. */
  options?: Record<string, unknown>;
  /** Computed constants/templates, incl. the Legacy_NPSP_Id__c external id. */
  constants?: Record<string, string>;
}

/** External-ID field provisioned on every target object for idempotent upserts. */
export const LEGACY_EXTERNAL_ID_FIELD = "Legacy_NPSP_Id__c";
