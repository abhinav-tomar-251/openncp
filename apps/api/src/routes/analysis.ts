import type { FastifyInstance } from "fastify";
import { prisma } from "@opennpc/db";
import { requireAuth } from "../auth.js";
import { getOwnedProject } from "../lib/ownership.js";
import { buildAnalysisReport, renderAnalysisMarkdown } from "../lib/analysisReport.js";

/**
 * The NPSP Analysis Report — the operator-facing understanding of the source org,
 * built purely from data captured at Analyze (object_run.checkpoint + stage_run.audit
 * + mapping_definition + org_connection). No live Salesforce calls.
 *
 * GET /projects/:id/analysis            → structured JSON (for the UI)
 * GET /projects/:id/analysis?format=json → JSON as a download
 * GET /projects/:id/analysis?format=md   → Markdown document download
 * See docs/sprint_four_planning/02-analysis-report.md.
 */
export async function analysisRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/projects/:id/analysis", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { format } = req.query as { format?: string };

    const project = await getOwnedProject(req.userId!, id);
    if (!project) return reply.code(404).send({ error: "project not found" });

    // Latest Analyze run WITH the full checkpoints (this endpoint does NOT strip
    // checkpoint.fields — unlike GET /stages/analyze — because the report needs them).
    const stageRun = await prisma.stageRun.findFirst({
      where: { projectId: id, stage: "analyze" },
      orderBy: { createdAt: "desc" },
      include: { objectRuns: { orderBy: { objectApiName: "asc" } } },
    });
    if (!stageRun) return reply.code(400).send({ error: "run Analyze first" });

    const [mappings, connections] = await Promise.all([
      prisma.mappingDefinition.findMany({
        where: { projectId: id },
        select: { object: true, target: true, fieldMap: true, enabled: true, confidence: true },
      }),
      prisma.orgConnection.findMany({
        where: { projectId: id },
        select: { role: true, orgId: true, instanceUrl: true, apiVersion: true, tokenMeta: true },
      }),
    ]);

    const report = buildAnalysisReport(project.name, stageRun, mappings, connections);

    if (format === "md") {
      reply.header("Content-Type", "text/markdown; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="npsp-analysis-${id}.md"`);
      return renderAnalysisMarkdown(report);
    }
    if (format === "json") {
      reply.header("Content-Type", "application/json");
      reply.header("Content-Disposition", `attachment; filename="npsp-analysis-${id}.json"`);
      return report;
    }
    return report;
  });
}
