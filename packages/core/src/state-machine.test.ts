import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  canStartStage,
  deriveStageStatus,
  nextStage,
  previousStage,
} from "./state-machine.js";

test("legal and illegal stage transitions", () => {
  assert.equal(canTransition("NOT_STARTED", "QUEUED"), true);
  assert.equal(canTransition("RUNNING", "AWAITING_REVIEW"), true);
  assert.equal(canTransition("AWAITING_REVIEW", "APPROVED"), true);
  assert.equal(canTransition("DONE", "QUEUED"), true); // re-run a stage
  assert.equal(canTransition("NOT_STARTED", "DONE"), false);
  assert.equal(canTransition("QUEUED", "APPROVED"), false);
});

test("stage ordering helpers", () => {
  assert.equal(previousStage("analyze"), null);
  assert.equal(nextStage("analyze"), "extract");
  assert.equal(nextStage("validate"), null);
});

test("gate guard: cannot start a stage until the previous is approved/done", () => {
  assert.equal(canStartStage("analyze", {}), true); // first stage, no predecessor
  assert.equal(canStartStage("extract", { analyze: "AWAITING_REVIEW" }), false);
  assert.equal(canStartStage("extract", { analyze: "APPROVED" }), true);
  assert.equal(canStartStage("extract", { analyze: "DONE" }), true);
});

test("derive stage status from object statuses", () => {
  assert.equal(deriveStageStatus([]), "QUEUED");
  assert.equal(deriveStageStatus(["COMPLETED", "RUNNING"]), "RUNNING");
  assert.equal(deriveStageStatus(["COMPLETED", "FAILED"]), "FAILED");
  assert.equal(deriveStageStatus(["COMPLETED", "PARTIAL"]), "AWAITING_REVIEW");
});
