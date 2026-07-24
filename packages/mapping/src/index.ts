/**
 * @opennpc/mapping — the transformation engine and default NPSP -> NPC mappings.
 * See docs/08-transformation-engine.md.
 */

export * from "./engine.js";
export * from "./defaults.js";
export * from "./userMatch.js";
export * from "./draft.js";

/** External-ID field provisioned on every target object for idempotent upserts. */
export const LEGACY_EXTERNAL_ID_FIELD = "Legacy_NPSP_Id__c";

/** Link a source lookup to a target parent via the parent's external id (resolved at load). */
export interface LookupMapping {
  /** Target relationship name, e.g. "Campaign" or "Parent". */
  relationship: string;
  /** Target object the parent maps to (for id_xref clarity). */
  targetObject: string;
  /** External-id field on the parent used to resolve the link. Defaults to Legacy_NPSP_Id__c. */
  externalIdField?: string;
}

export interface MappingDefinition {
  /** Source object API name, e.g. "Opportunity". */
  source: string;
  /** Target object API name, e.g. "GiftTransaction". */
  target: string;
  /** Only transform source rows for which this predicate returns true. */
  filter?: (raw: Record<string, unknown>) => boolean;
  /** Source field -> target field (scalar copy). */
  fieldMap: Record<string, string>;
  /** Per-source-field value translation (picklists, stages). */
  valueMap?: Record<string, Record<string, string>>;
  /** Source Id field -> lookup, written as `${relationship}.${externalIdField}` = source parent id. */
  lookups?: Record<string, LookupMapping>;
  /** Static target field values. */
  constants?: Record<string, unknown>;
  /** Optional financial reconciliation spec for the Validate stage. */
  reconcile?: {
    /** Target-object numeric field to sum, e.g. "OriginalAmount" (docs/09 §1). */
    amountField: string;
  };
}
