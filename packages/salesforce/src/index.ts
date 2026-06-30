/**
 * @opennpc/salesforce — typed wrappers over jsforce v3.
 *
 * M2: ECA OAuth (auth.ts), connection factory (connection.ts), capability probe
 * (capabilities.ts). Bulk API 2.0 query/upsert + schema discovery land in M3.
 * See docs/07-salesforce-integration.md.
 */

export * from "./auth.js";
export * from "./connection.js";
export * from "./capabilities.js";

export type OrgRole = "source" | "target";

/** Bulk API 2.0 surface (implemented in M3). */
export interface BulkClient {
  query(soql: string, opts?: { pkChunking?: boolean }): AsyncIterable<Record<string, unknown>>;
  upsert(
    object: string,
    externalIdField: string,
    records: Record<string, unknown>[],
  ): Promise<{
    successes: { id: string; sourceExtId: string }[];
    failures: { sourceExtId: string; message: string }[];
  }>;
}

/** Placeholder factory — real implementation wires jsforce Bulk in M3. */
export function createBulkClient(): BulkClient {
  throw new Error("BulkClient not implemented yet (Milestone 3)");
}
