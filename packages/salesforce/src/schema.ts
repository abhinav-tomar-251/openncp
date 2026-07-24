import type { Connection } from "jsforce";

/**
 * Schema discovery: describe objects/fields, count records, and build the SOQL
 * used by the Extract stage. See docs/07-salesforce-integration.md §3.
 */

export interface SelectableField {
  name: string;
  type: string;
  custom: boolean;
}

/** Field types that cannot appear in a (Bulk) SOQL SELECT. */
const NON_SELECTABLE_TYPES = new Set(["address", "location", "base64", "complexvalue"]);

/** Fields safe to include in an extract SELECT (excludes compound/base64 fields). */
export async function getSelectableFields(
  conn: Connection,
  object: string,
): Promise<SelectableField[]> {
  const desc = await conn.describe(object);
  return desc.fields
    .filter((f) => !NON_SELECTABLE_TYPES.has(f.type))
    .map((f) => ({ name: f.name, type: f.type, custom: f.custom }));
}

/** Build a `SELECT ... FROM object [WHERE ...]` query. Always includes at least Id. */
export function buildSelectSoql(object: string, fieldNames: string[], where?: string): string {
  const unique = Array.from(new Set(["Id", ...fieldNames]));
  return `SELECT ${unique.join(", ")} FROM ${object}${where ? ` WHERE ${where}` : ""}`;
}

/** Total record count for an object via `SELECT COUNT()`. */
export async function countRecords(conn: Connection, object: string): Promise<number> {
  const res = await conn.query(`SELECT COUNT() FROM ${object}`);
  return res.totalSize;
}

/**
 * Build an aggregate `SELECT COUNT(Id)[, SUM(amountField)] FROM object WHERE
 * extIdField != null` query — scopes the aggregate to only records this platform
 * migrated (identified by having the external-id field populated). Used by the
 * Validate stage to read back the live target org state. See docs/09 §1.
 */
export function buildAggregateSoql(object: string, extIdField: string, amountField?: string): string {
  const select = amountField ? `COUNT(Id) cnt, SUM(${amountField}) amt` : "COUNT(Id) cnt";
  return `SELECT ${select} FROM ${object} WHERE ${extIdField} != null`;
}

export interface AggregateResult {
  count: number;
  sum: number | null;
}

/** Run the aggregate query built by buildAggregateSoql and return {count, sum}. */
export async function aggregateByExternalId(
  conn: Connection,
  object: string,
  extIdField: string,
  amountField?: string,
): Promise<AggregateResult> {
  const soql = buildAggregateSoql(object, extIdField, amountField);
  const res = await conn.query<{ cnt: number; amt?: number | null }>(soql);
  const row = res.records[0];
  return { count: row?.cnt ?? 0, sum: amountField ? (row?.amt ?? 0) : null };
}

/** Of the given candidate objects, return those that exist and are queryable in the org. */
export async function listPresentObjects(
  conn: Connection,
  candidates: readonly string[],
): Promise<string[]> {
  const global = await conn.describeGlobal();
  const queryable = new Set(global.sobjects.filter((s) => s.queryable).map((s) => s.name));
  return candidates.filter((c) => queryable.has(c));
}
