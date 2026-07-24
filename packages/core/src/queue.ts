import PgBoss from "pg-boss";

/** Durable job queue names. Stage work decomposes into per-object jobs. */
export const QUEUES = {
  /** Foundation smoke-test job (Milestone 1). */
  NOOP: "noop",
  ANALYZE_SCHEMA: "analyze.schema",
  /** Plan an extract: discover present objects, create object_runs, fan out. */
  EXTRACT_PLAN: "extract.plan",
  EXTRACT_OBJECT: "extract.object",
  /** Plan a transform: create object_runs for mapped source objects, fan out. */
  TRANSFORM_PLAN: "transform.plan",
  TRANSFORM_OBJECT: "transform.object",
  PREPARE_TARGET: "prepare.target",
  /** Plan a load: create object_runs in dependency order, chain them. */
  LOAD_PLAN: "load.plan",
  LOAD_OBJECT: "load.object",
  /** Plan a validate: create object_runs for loaded target objects, fan out. */
  VALIDATE_PLAN: "validate.plan",
  VALIDATE_RECONCILE: "validate.reconcile",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Create a pg-boss instance backed by Postgres (no Redis required).
 * pg-boss creates and manages its own `pgboss` schema on start().
 */
export function createBoss(connectionString = process.env.DATABASE_URL): PgBoss {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to create the pg-boss queue");
  }
  return new PgBoss({
    connectionString,
    // Keep completed jobs briefly for observability; archive cleans them up.
    retentionMinutes: 60,
  });
}

export { PgBoss };
