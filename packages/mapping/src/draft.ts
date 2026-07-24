import { DEFAULT_MAPPINGS } from "./defaults.js";
import type { LookupMapping, MappingDefinition } from "./index.js";

/**
 * Heuristic mapping drafter. Given a source object's real schema and the target
 * org's full object inventory, propose a best-effort NPSP -> NPC mapping — WITHOUT
 * any hardcoded object list. Pure and dependency-free so the whole matcher is unit
 * testable independent of Salesforce. See the plan "Dynamic, analysis-driven
 * mapping layer" and docs/08-transformation-engine.md.
 *
 * Honest scope: heuristics reliably handle near-pass-through objects (Campaign,
 * custom `__c` objects with matching field names). They are WEAK on the classic
 * NPSP->NPC model shifts (Contact->Account PersonAccount, RecurringDonation->
 * GiftCommitment) whose correspondence isn't derivable from schema — those are
 * covered by the curated seed templates (DEFAULT_MAPPINGS) when present, and
 * otherwise draft weakly for the user to correct. Nothing is auto-applied.
 */

export interface DraftFieldMeta {
  name: string;
  label: string;
  type: string;
}

export interface DraftObject {
  name: string;
  label: string;
  fields: DraftFieldMeta[];
}

export type DraftConfidence = "curated" | "heuristic" | "unmapped";

export interface MappingDraft {
  source: string;
  target: string | null;
  fieldMap: Record<string, string>;
  valueMap?: Record<string, Record<string, string>>;
  lookups?: Record<string, LookupMapping>;
  constants?: Record<string, unknown>;
  reconcile?: { amountField: string };
  confidence: DraftConfidence;
  /** Curated seeds are trusted (enable by default); heuristic/unmapped need review. */
  enabledByDefault: boolean;
}

/** Managed-package / custom suffixes+prefixes stripped so names compare on their meaning. */
const NAMESPACE_PREFIXES = ["npsp__", "npe01__", "npe03__", "npe4__", "npe5__", "npo02__", "pmdm__"];

/** System/audit fields never worth drafting a data mapping for. */
const SKIP_FIELDS = new Set([
  "Id",
  "IsDeleted",
  "OwnerId", // remapped separately via the User id_xref
  "CreatedById",
  "CreatedDate",
  "LastModifiedById",
  "LastModifiedDate",
  "SystemModstamp",
  "LastActivityDate",
  "LastViewedDate",
  "LastReferencedDate",
]);

/** Lowercase, strip namespace prefixes + `__c`, split camelCase/underscores into tokens. */
export function normalizeTokens(raw: string): string[] {
  let s = raw;
  for (const p of NAMESPACE_PREFIXES) {
    if (s.toLowerCase().startsWith(p)) s = s.slice(p.length);
  }
  s = s.replace(/__c$/i, "").replace(/__r$/i, "");
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase boundary
    .replace(/[_\-.]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Jaccard token overlap of two strings, 0..1. */
export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalizeTokens(a));
  const tb = new Set(normalizeTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Coarse type family — draft a field map only within the same family. */
function typeFamily(type: string): string {
  switch (type) {
    case "string":
    case "textarea":
    case "phone":
    case "email":
    case "url":
    case "picklist":
    case "multipicklist":
    case "combobox":
    case "encryptedstring":
      return "text";
    case "double":
    case "int":
    case "long":
    case "currency":
    case "percent":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "boolean":
      return "boolean";
    case "reference":
      return "reference";
    default:
      return type;
  }
}

/** Best-effort source-field -> target-field map (scalar, same-type-family only). */
export function draftFieldMap(
  sourceFields: readonly DraftFieldMeta[],
  targetFields: readonly DraftFieldMeta[],
): Record<string, string> {
  const targets = targetFields.filter(
    (f) => !SKIP_FIELDS.has(f.name) && typeFamily(f.type) !== "reference",
  );
  const byLowerName = new Map(targets.map((f) => [f.name.toLowerCase(), f]));
  const byLowerLabel = new Map(targets.map((f) => [f.label.toLowerCase(), f]));

  const map: Record<string, string> = {};
  for (const sf of sourceFields) {
    if (SKIP_FIELDS.has(sf.name) || typeFamily(sf.type) === "reference") continue;

    // exact name > case-insensitive name > exact label; each gated by type family.
    const exact = targets.find((t) => t.name === sf.name);
    const ci = byLowerName.get(sf.name.toLowerCase());
    const byLabel = byLowerLabel.get(sf.label.toLowerCase());
    let best = exact ?? ci ?? byLabel;

    if (!best) {
      // token-similarity fallback, gated by type family and a threshold.
      let bestScore = 0.6;
      for (const t of targets) {
        if (typeFamily(t.type) !== typeFamily(sf.type)) continue;
        const score = tokenOverlap(sf.name, t.name);
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      }
    }
    if (best && typeFamily(best.type) === typeFamily(sf.type)) map[sf.name] = best.name;
  }
  return map;
}

/** Fraction of source data-fields whose normalized name appears among the target's fields. */
function fieldNameCoverage(source: DraftObject, target: DraftObject): number {
  const dataFields = source.fields.filter((f) => !SKIP_FIELDS.has(f.name));
  if (dataFields.length === 0) return 0;
  const targetTokens = new Set<string>();
  for (const f of target.fields) for (const tok of normalizeTokens(f.name)) targetTokens.add(tok);
  let hit = 0;
  for (const f of dataFields) {
    const toks = normalizeTokens(f.name);
    if (toks.length > 0 && toks.every((t) => targetTokens.has(t))) hit++;
  }
  return hit / dataFields.length;
}

/** Object-match score, 0..1: object name/label similarity blended with field-name coverage. */
export function scoreObjectMatch(source: DraftObject, target: DraftObject): number {
  const nameScore = Math.max(
    tokenOverlap(source.name, target.name),
    tokenOverlap(source.label, target.label),
  );
  return 0.6 * nameScore + 0.4 * fieldNameCoverage(source, target);
}

const OBJECT_MATCH_THRESHOLD = 0.34;

/**
 * Draft a mapping for one source object. A curated seed template wins when it
 * exists AND its target object is actually present in this org; otherwise the
 * best-scoring target above threshold is proposed with a drafted field map; else
 * unmapped (needs a human to pick). Never auto-applies (heuristic/unmapped default
 * to disabled).
 */
export function draftMapping(
  source: DraftObject,
  targetInventory: readonly DraftObject[],
  curated: Record<string, MappingDefinition> = DEFAULT_MAPPINGS,
): MappingDraft {
  const targetNames = new Set(targetInventory.map((t) => t.name));

  const template = curated[source.name];
  if (template && targetNames.has(template.target)) {
    return {
      source: source.name,
      target: template.target,
      fieldMap: template.fieldMap,
      valueMap: template.valueMap,
      lookups: template.lookups,
      constants: template.constants,
      reconcile: template.reconcile,
      confidence: "curated",
      enabledByDefault: true,
    };
  }

  let best: DraftObject | null = null;
  let bestScore = OBJECT_MATCH_THRESHOLD;
  for (const t of targetInventory) {
    const score = scoreObjectMatch(source, t);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }

  if (!best) {
    return { source: source.name, target: null, fieldMap: {}, confidence: "unmapped", enabledByDefault: false };
  }
  return {
    source: source.name,
    target: best.name,
    fieldMap: draftFieldMap(source.fields, best.fields),
    confidence: "heuristic",
    enabledByDefault: false,
  };
}
