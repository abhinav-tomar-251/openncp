/** The five migration stages, in order. See docs/04-migration-workflow.md. */
export const STAGES = ["analyze", "extract", "transform", "load", "validate"] as const;
export type StageName = (typeof STAGES)[number];

/** Stage-level status machine. */
export const STAGE_STATUSES = [
  "NOT_STARTED",
  "QUEUED",
  "RUNNING",
  "AWAITING_REVIEW",
  "APPROVED",
  "DONE",
  "FAILED",
] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

/** Per-object status within a stage. */
export const OBJECT_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
] as const;
export type ObjectStatus = (typeof OBJECT_STATUSES)[number];
