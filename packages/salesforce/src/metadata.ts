import type { Connection } from "jsforce";

/**
 * Target-schema preparation via the Metadata API: create the external-ID text
 * field that makes loads idempotent (upsert keyed on it) and links target records
 * back to their NPSP source. See docs/07-salesforce-integration.md §4.
 *
 * We do NOT deploy NPSP's managed-package metadata into NPC — we only prepare the
 * target org to receive data.
 */
export const DEFAULT_EXTERNAL_ID_FIELD = "Legacy_NPSP_Id__c";

export type EnsureFieldOutcome = "exists" | "created";

export interface PrepareFieldResult {
  object: string;
  field: string;
  outcome: EnsureFieldOutcome | "error";
  message?: string;
}

interface SaveResultLike {
  success?: boolean;
  errors?: unknown;
}
interface MetadataInfoLike {
  fullName?: string;
}

/**
 * Ensure an external-ID Text field exists on `object`. Idempotent: reads first and
 * creates only if missing. Returns whether it already existed or was created.
 */
export async function ensureExternalIdField(
  conn: Connection,
  object: string,
  fieldName: string = DEFAULT_EXTERNAL_ID_FIELD,
): Promise<EnsureFieldOutcome> {
  const fullName = `${object}.${fieldName}`;

  const read = (await conn.metadata.read("CustomField", fullName)) as
    | MetadataInfoLike
    | MetadataInfoLike[];
  const info = Array.isArray(read) ? read[0] : read;
  if (info?.fullName) return "exists";

  const result = (await conn.metadata.create("CustomField", {
    fullName,
    label: "Legacy NPSP Id",
    type: "Text",
    length: 18,
    externalId: true,
    unique: true,
  })) as SaveResultLike | SaveResultLike[];
  const saved = Array.isArray(result) ? result[0] : result;
  if (saved && saved.success === false) {
    throw new Error(`Failed to create ${fullName}: ${JSON.stringify(saved.errors)}`);
  }
  return "created";
}

/** Ensure the external-ID field on each target object; never throws — reports per object. */
export async function prepareExternalIdFields(
  conn: Connection,
  objects: readonly string[],
  fieldName: string = DEFAULT_EXTERNAL_ID_FIELD,
): Promise<PrepareFieldResult[]> {
  const results: PrepareFieldResult[] = [];
  for (const object of objects) {
    try {
      const outcome = await ensureExternalIdField(conn, object, fieldName);
      results.push({ object, field: fieldName, outcome });
    } catch (e) {
      results.push({ object, field: fieldName, outcome: "error", message: (e as Error).message });
    }
  }
  return results;
}

/**
 * Resolve the target org's Person Account record type on Account, needed to
 * create Person Accounts via the API (RecordTypeId must be set explicitly on
 * insert/upsert). `RecordType.IsPersonType` is a real, queryable field in any org
 * with Person Accounts enabled. Returns null if not found (org may not have
 * Person Accounts enabled — surfaced as a capability blocker elsewhere).
 */
export async function findPersonAccountRecordTypeId(conn: Connection): Promise<string | null> {
  const res = await conn.query<{ Id: string }>(
    "SELECT Id FROM RecordType WHERE SObjectType = 'Account' AND IsPersonType = true LIMIT 1",
  );
  return res.records[0]?.Id ?? null;
}
