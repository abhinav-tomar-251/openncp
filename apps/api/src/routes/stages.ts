import type { FastifyInstance } from "fastify";
import { prisma } from "@opennpc/db";
import { QUEUES, canStartStage, canTransition, previousStage, type PgBoss, type StageName } from "@opennpc/core";
import { requireAuth } from "../auth.js";
import { getOwnedProject } from "../lib/ownership.js";
import { getLatestStatusByStage } from "../lib/stageStatus.js";

/**
 * Stage control routes. The api creates a stage_run and enqueues a planner; the
 * worker does the work and reports per-object results. Every stage after the
 * first requires its predecessor to have been explicitly approved (the review
 * gate) — see docs/10-api-and-jobs.md and docs/04-migration-workflow.md.
 */

type RunnableStage = StageName; // "analyze" | "extract" | "transform" | "load" | "validate"

const PLAN_QUEUE: Record<RunnableStage, string> = {
  analyze: QUEUES.ANALYZE_SCHEMA,
  extract: QUEUES.EXTRACT_PLAN,
  transform: QUEUES.TRANSFORM_PLAN,
  load: QUEUES.LOAD_PLAN,
  validate: QUEUES.VALIDATE_PLAN,
};
/** Analyze intentionally has no entry: its describe+count pass runs inline, so
 * there's nothing meaningful to retry in isolation (see the plan that added Analyze). */
const OBJECT_QUEUE: Partial<Record<RunnableStage, string>> = {
  extract: QUEUES.EXTRACT_OBJECT,
  transform: QUEUES.TRANSFORM_OBJECT,
  load: QUEUES.LOAD_OBJECT,
  validate: QUEUES.VALIDATE_RECONCILE,
};

function isRunnableStage(s: string): s is RunnableStage {
  return s === "analyze" || s === "extract" || s === "transform" || s === "load" || s === "validate";
}

export async function stageRoutes(app: FastifyInstance, boss: PgBoss): Promise<void> {
  app.addHook("preHandler", requireAuth);

  /** Run (or re-run) a stage: creates a stage_run and enqueues its planner. */
  app.post("/projects/:id/stages/:stage/run", async (req, reply) => {
    const { id, stage } = req.params as { id: string; stage: string };
    if (!isRunnableStage(stage)) return reply.code(400).send({ error: "unsupported stage" });

    const project = await getOwnedProject(req.userId!, id);
    if (!project) return reply.code(404).send({ error: "project not found" });

    // The review gate: a stage may only start once its predecessor's latest run
    // has been explicitly approved. Uses the same tested logic that already
    // exists in @opennpc/core (canStartStage) rather than reimplementing it here.
    const statusByStage = await getLatestStatusByStage(id);
    if (!canStartStage(stage, statusByStage)) {
      const prev = previousStage(stage);
      return reply.code(400).send({ error: `Approve ${prev} first` });
    }

    if (stage === "analyze" || stage === "extract") {
      const source = await prisma.orgConnection.findUnique({
        where: { projectId_role: { projectId: id, role: "source" } },
      });
      if (!source) return reply.code(400).send({ error: "connect a source (NPSP) org first" });
    } else if (stage === "transform") {
      const staged = await prisma.stagingSource.count({ where: { projectId: id } });
      if (staged === 0) return reply.code(400).send({ error: "run Extract first (no staged data)" });
    } else if (stage === "load") {
      const target = await prisma.orgConnection.findUnique({
        where: { projectId_role: { projectId: id, role: "target" } },
      });
      if (!target) return reply.code(400).send({ error: "connect a target (NPC) org first" });
      const staged = await prisma.stagingTarget.count({ where: { projectId: id } });
      if (staged === 0) return reply.code(400).send({ error: "run Transform first (no target-shaped data)" });
    } else if (stage === "validate") {
      const target = await prisma.orgConnection.findUnique({
        where: { projectId_role: { projectId: id, role: "target" } },
      });
      if (!target) return reply.code(400).send({ error: "connect a target (NPC) org first" });
      const loaded = await prisma.stagingTarget.count({ where: { projectId: id, loadStatus: "loaded" } });
      if (loaded === 0) return reply.code(400).send({ error: "run Load first (no loaded records)" });
    }

    const attempt = (await prisma.stageRun.count({ where: { projectId: id, stage } })) + 1;
    const stageRun = await prisma.stageRun.create({
      data: { projectId: id, stage, status: "QUEUED", attempt, startedAt: new Date() },
    });

    await boss.send(PLAN_QUEUE[stage], { stageRunId: stageRun.id });
    return reply.code(202).send(stageRun);
  });

  /** Latest run of a stage + its per-object runs. */
  app.get("/projects/:id/stages/:stage", async (req, reply) => {
    const { id, stage } = req.params as { id: string; stage: string };
    if (!isRunnableStage(stage)) return reply.code(400).send({ error: "unsupported stage" });
    if (!(await getOwnedProject(req.userId!, id))) {
      return reply.code(404).send({ error: "project not found" });
    }
    const stageRun = await prisma.stageRun.findFirst({
      where: { projectId: id, stage },
      orderBy: { createdAt: "desc" },
      include: { objectRuns: { orderBy: { objectApiName: "asc" } } },
    });
    if (!stageRun) return { status: "NOT_STARTED", objectRuns: [] };

    // Analyze's checkpoints carry full per-object field metadata (captured for
    // future mapping work — see the plan that introduced this) which can be very
    // large across 1000+ objects. Replace it with just a count for the payload
    // the browser fetches — the full data stays in the database, queryable
    // (e.g. via the object_run.checkpoint column) whenever it's actually needed.
    if (stage === "analyze") {
      return {
        ...stageRun,
        objectRuns: stageRun.objectRuns.map((o) => {
          const { fields, ...rest } = (o.checkpoint ?? {}) as Record<string, unknown>;
          const fieldCount = Array.isArray(fields) ? fields.length : undefined;
          return { ...o, checkpoint: { ...rest, fieldCount } };
        }),
      };
    }
    return stageRun;
  });

  /** Approve a stage's latest run (the review gate) so the next stage can start. */
  app.post("/projects/:id/stages/:stage/approve", async (req, reply) => {
    const { id, stage } = req.params as { id: string; stage: string };
    if (!isRunnableStage(stage)) return reply.code(400).send({ error: "unsupported stage" });
    if (!(await getOwnedProject(req.userId!, id))) {
      return reply.code(404).send({ error: "project not found" });
    }
    const latest = await prisma.stageRun.findFirst({
      where: { projectId: id, stage },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) return reply.code(404).send({ error: "no run to approve" });
    if (!canTransition(latest.status, "APPROVED")) {
      return reply.code(400).send({ error: `stage is ${latest.status}, not awaiting review` });
    }
    const updated = await prisma.stageRun.update({
      where: { id: latest.id },
      data: { status: "APPROVED", approvedBy: req.userId, approvedAt: new Date() },
    });
    return updated;
  });

  /** Retry a single failed object without redoing the rest of its stage. */
  app.post("/projects/:id/objects/:objectRunId/retry", async (req, reply) => {
    const { id, objectRunId } = req.params as { id: string; objectRunId: string };
    if (!(await getOwnedProject(req.userId!, id))) {
      return reply.code(404).send({ error: "project not found" });
    }
    const objectRun = await prisma.objectRun.findUnique({
      where: { id: objectRunId },
      include: { stageRun: true },
    });
    // Also confirm the object run actually belongs to the :id project in the URL,
    // not just that the caller owns *some* project (IDOR guard).
    if (!objectRun || objectRun.stageRun.projectId !== id) {
      return reply.code(404).send({ error: "object run not found" });
    }

    const stage = objectRun.stageRun.stage;
    if (!isRunnableStage(stage)) return reply.code(400).send({ error: "stage not retryable" });
    const objectQueue = OBJECT_QUEUE[stage];
    if (!objectQueue) {
      return reply.code(400).send({ error: `${stage} does not support per-object retry — re-run the whole stage` });
    }

    await prisma.objectRun.update({
      where: { id: objectRunId },
      data: { status: "PENDING", failedCount: 0, finishedAt: null },
    });
    await prisma.stageRun.update({
      where: { id: objectRun.stageRunId },
      data: { status: "RUNNING", finishedAt: null },
    });
    await boss.send(objectQueue, { objectRunId });
    return { retried: true };
  });

  /** Prepare the target org schema (external-ID fields on target objects). */
  app.post("/projects/:id/prepare-target", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await getOwnedProject(req.userId!, id))) {
      return reply.code(404).send({ error: "project not found" });
    }
    const target = await prisma.orgConnection.findUnique({
      where: { projectId_role: { projectId: id, role: "target" } },
    });
    if (!target) return reply.code(400).send({ error: "connect a target (NPC) org first" });
    await boss.send(QUEUES.PREPARE_TARGET, { projectId: id });
    return reply.code(202).send({ started: true });
  });

  /** The migration/reconciliation report, built from the latest Validate run. */
  app.get("/projects/:id/report", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { format } = req.query as { format?: string };

    const project = await getOwnedProject(req.userId!, id);
    if (!project) return reply.code(404).send({ error: "project not found" });

    const stageRun = await prisma.stageRun.findFirst({
      where: { projectId: id, stage: "validate" },
      orderBy: { createdAt: "desc" },
      include: { objectRuns: { orderBy: { objectApiName: "asc" } } },
    });
    if (!stageRun) return reply.code(400).send({ error: "run Validate first" });

    type Row = {
      targetObject: string;
      sourceObject: string;
      expectedCount: number;
      loadedCount: number;
      errorCount: number;
      liveCount: number;
      localSum: number | null;
      liveSum: number | null;
      outcome: string;
      notes: string[];
    };
    const rows: Row[] = stageRun.objectRuns.map((o) => {
      const cp = (o.checkpoint ?? {}) as Partial<Row>;
      return {
        targetObject: o.objectApiName,
        sourceObject: cp.sourceObject ?? "",
        expectedCount: cp.expectedCount ?? 0,
        loadedCount: cp.loadedCount ?? 0,
        errorCount: cp.errorCount ?? 0,
        liveCount: cp.liveCount ?? 0,
        localSum: cp.localSum ?? null,
        liveSum: cp.liveSum ?? null,
        outcome: cp.outcome ?? (o.status === "FAILED" ? "FAIL" : "PASS"),
        notes: cp.notes ?? [],
      };
    });
    const overall = rows.some((r) => r.outcome === "FAIL")
      ? "FAIL"
      : rows.some((r) => r.outcome === "PARTIAL")
        ? "PARTIAL"
        : "PASS";

    if (format === "csv") {
      const header = "targetObject,sourceObject,expectedCount,loadedCount,errorCount,liveCount,localSum,liveSum,outcome";
      const lines = rows.map((r) =>
        [
          r.targetObject,
          r.sourceObject,
          r.expectedCount,
          r.loadedCount,
          r.errorCount,
          r.liveCount,
          r.localSum ?? "",
          r.liveSum ?? "",
          r.outcome,
        ].join(","),
      );
      reply.header("Content-Type", "text/csv");
      reply.header("Content-Disposition", `attachment; filename="migration-report-${id}.csv"`);
      return [header, ...lines].join("\n");
    }

    return {
      projectId: id,
      projectName: project.name,
      generatedAt: new Date().toISOString(),
      overall,
      rows,
    };
  });
}
