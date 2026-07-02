import { STAGES, type StageName, type StageStatus } from "./types.js";

/**
 * Allowed stage status transitions. See the state diagram in
 * docs/04-migration-workflow.md §2. No automatic stage->stage jump: advancing to
 * the next stage is gated by the previous stage being APPROVED/DONE (see canStartStage).
 */
const TRANSITIONS: Record<StageStatus, readonly StageStatus[]> = {
  NOT_STARTED: ["QUEUED"],
  QUEUED: ["RUNNING"],
  RUNNING: ["AWAITING_REVIEW", "FAILED"],
  AWAITING_REVIEW: ["APPROVED", "QUEUED"], // approve, or re-run this stage
  APPROVED: ["DONE"],
  DONE: ["QUEUED"], // re-run a completed stage (e.g. mapping changed)
  FAILED: ["QUEUED"], // retry failed objects
};

export function canTransition(from: StageStatus, to: StageStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: StageStatus,
    public readonly to: StageStatus,
  ) {
    super(`Illegal stage transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function assertTransition(from: StageStatus, to: StageStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

export function stageIndex(stage: StageName): number {
  return STAGES.indexOf(stage);
}

export function previousStage(stage: StageName): StageName | null {
  const i = stageIndex(stage);
  return i > 0 ? STAGES[i - 1]! : null;
}

export function nextStage(stage: StageName): StageName | null {
  const i = stageIndex(stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1]! : null;
}

/**
 * Gate guard: a stage may only start (NOT_STARTED/DONE/FAILED -> QUEUED) when the
 * previous stage has been APPROVED or DONE. The first stage (analyze) has no
 * predecessor and may always start.
 */
export function canStartStage(
  stage: StageName,
  statusByStage: Partial<Record<StageName, StageStatus>>,
): boolean {
  const prev = previousStage(stage);
  if (prev === null) return true;
  const prevStatus = statusByStage[prev];
  return prevStatus === "APPROVED" || prevStatus === "DONE";
}

/**
 * Derive a stage's status from its object-run statuses. The worker reports
 * object-level results; the controller derives the stage status from them.
 */
export function deriveStageStatus(objectStatuses: readonly string[]): StageStatus {
  if (objectStatuses.length === 0) return "QUEUED";
  // Active objects take precedence: stay RUNNING until every object settles, so a
  // failure alongside still-running objects doesn't flip the stage to FAILED early.
  if (objectStatuses.some((s) => s === "PENDING" || s === "RUNNING")) return "RUNNING";
  if (objectStatuses.some((s) => s === "FAILED")) return "FAILED";
  // all COMPLETED or PARTIAL
  return "AWAITING_REVIEW";
}
