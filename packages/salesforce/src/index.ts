/**
 * @opennpc/salesforce — typed wrappers over jsforce v3.
 *
 * Foundation stub (Milestone 1): the interface surface is defined here so apps can
 * depend on it; concrete implementations land in later milestones
 * (M2 auth, M3 bulk2 + schema). See docs/07-salesforce-integration.md.
 */

export type OrgRole = "source" | "target";

export interface OrgConnectionConfig {
  instanceUrl: string;
  accessToken: string;
  apiVersion?: string;
  /** Source connections are read-only; any write attempt must throw. */
  readOnly?: boolean;
}

/** Bulk API 2.0 surface (implemented in M3). */
export interface BulkClient {
  query(soql: string, opts?: { pkChunking?: boolean }): AsyncIterable<Record<string, unknown>>;
  upsert(
    object: string,
    externalIdField: string,
    records: Record<string, unknown>[],
  ): Promise<{ successes: { id: string; sourceExtId: string }[]; failures: { sourceExtId: string; message: string }[] }>;
}

/** Schema discovery surface (implemented in M3/M5). */
export interface SchemaClient {
  describeGlobal(): Promise<string[]>;
  describe(object: string): Promise<unknown>;
  countRecords(object: string): Promise<number>;
}

/** Placeholder factory — real implementation wires jsforce in M2/M3. */
export function createBulkClient(_config: OrgConnectionConfig): BulkClient {
  throw new Error("BulkClient not implemented yet (Milestone 3)");
}

export function createSchemaClient(_config: OrgConnectionConfig): SchemaClient {
  throw new Error("SchemaClient not implemented yet (Milestone 3)");
}
