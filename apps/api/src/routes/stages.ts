import type { FastifyInstance } from "fastify";
import { prisma } from "@opennpc/db";
import { QUEUES, type PgBoss } from "@opennpc/core";

/**
 * Stage control routes. M3 implements the Extract stage; other stages follow the
 * same shape. The api creates the stage_run and enqueues work; the worker does
 * the Salesforce I/O and reports per-object results. See docs/10-api-and-jobs.md.
 */
export async function stageRoutes(app: FastifyInstance, boss: PgBoss): Promise<void> {
  /** Run (or re-run) the Extract stage: creates a stage_run and enqueues the planner. */
  app.post("/projects/:id/stages/extract/run", async (req, reply) => {
    const { id } = req.params as { id: string };

    const project = await prisma.migrationProject.findUnique({ where: { id } });
    if (!project) return reply.code(404).send({ error: "project not found" });

    const source = await prisma.orgConnection.findUnique({
      where: { projectId_role: { projectId: id, role: "source" } },
    });
    if (!source) return reply.code(400).send({ error: "connect a source (NPSP) org first" });

    const attempt = (await prisma.stageRun.count({ where: { projectId: id, stage: "extract" } })) + 1;
    const stageRun = await prisma.stageRun.create({
      data: { projectId: id, stage: "extract", status: "QUEUED", attempt, startedAt: new Date() },
    });

    await boss.send(QUEUES.EXTRACT_PLAN, { stageRunId: stageRun.id });
    return reply.code(202).send(stageRun);
  });

  /** Latest Extract stage status + its per-object runs. */
  app.get("/projects/:id/stages/extract", async (req) => {
    const { id } = req.params as { id: string };
    const stageRun = await prisma.stageRun.findFirst({
      where: { projectId: id, stage: "extract" },
      orderBy: { createdAt: "desc" },
      include: { objectRuns: { orderBy: { objectApiName: "asc" } } },
    });
    return stageRun ?? { status: "NOT_STARTED", objectRuns: [] };
  });

  /** Retry a single failed object without redoing the rest of the stage. */
  app.post("/projects/:id/objects/:objectRunId/retry", async (req, reply) => {
    const { objectRunId } = req.params as { objectRunId: string };
    const objectRun = await prisma.objectRun.findUnique({ where: { id: objectRunId } });
    if (!objectRun) return reply.code(404).send({ error: "object run not found" });

    await prisma.objectRun.update({
      where: { id: objectRunId },
      data: { status: "PENDING", failedCount: 0, finishedAt: null },
    });
    await prisma.stageRun.update({
      where: { id: objectRun.stageRunId },
      data: { status: "RUNNING", finishedAt: null },
    });
    await boss.send(QUEUES.EXTRACT_OBJECT, { objectRunId });
    return { retried: true };
  });
}
