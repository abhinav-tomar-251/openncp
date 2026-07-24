import { Connection } from "jsforce";

/** Re-exported so consumers can name the connection type without importing jsforce. */
export type { Connection } from "jsforce";

export const DEFAULT_API_VERSION = process.env.SF_API_VERSION ?? "62.0";

export interface SfConnectionConfig {
  instanceUrl: string;
  accessToken: string;
  version?: string;
  /**
   * Source connections are read-only. When true, any write (DML/ingest) must be
   * rejected. Enforcement for Bulk writes lands in Milestone 3; capability probes
   * (Milestone 2) are read-only regardless.
   */
  readOnly?: boolean;
}

/** Create a jsforce Connection from a stored access token + instance URL. */
export function createConnection(cfg: SfConnectionConfig): Connection {
  const conn = new Connection({
    instanceUrl: cfg.instanceUrl,
    accessToken: cfg.accessToken,
    version: cfg.version ?? DEFAULT_API_VERSION,
  });
  // Increase Bulk 2.0 polling timeout to 5 minutes (300000ms)
  conn.bulk2.pollTimeout = 300000;
  // Optionally increase polling interval to reduce API requests (e.g. 5 seconds)
  conn.bulk2.pollInterval = 5000;
  return conn;
}
