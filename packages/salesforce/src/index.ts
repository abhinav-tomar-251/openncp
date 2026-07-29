/**
 * @opennpc/salesforce — typed wrappers over jsforce v3.
 *
 * M2: ECA OAuth (auth.ts), connection factory (connection.ts), capability probe
 * (capabilities.ts).
 * M3: schema discovery (schema.ts), Bulk API 2.0 query (bulk2.ts), source catalog
 * (catalog.ts). Bulk 2.0 upsert (load) lands in M4.
 * See docs/07-salesforce-integration.md.
 */

export * from "./auth.js";
export * from "./connection.js";
export * from "./capabilities.js";
export * from "./schema.js";
export * from "./bulk2.js";
export * from "./catalog.js";
export * from "./metadata.js";
export * from "./discovery.js";
export * from "./orgAudit.js";

export type OrgRole = "source" | "target";
