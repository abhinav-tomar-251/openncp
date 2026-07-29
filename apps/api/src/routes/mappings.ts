import type { FastifyInstance } from "fastify";
import { prisma, type Prisma } from "@opennpc/db";
import { requireAuth } from "../auth.js";
import { getOwnedProject } from "../lib/ownership.js";

/**
 * Mapping routes — view and edit the analysis-seeded, DB-backed mapping layer.
 * This is the minimal engine-side API (the full Mapping Editor UI is a separate
 * Step-2 milestone); it lets you see every drafted mapping and correct/enable one.
 * See the plan "Dynamic, analysis-driven mapping layer".
 */
export async function mappingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  /**
   * All drafted mappings for a project (source object → target + status), each
   * annotated with `targetOutcome` — PASS/WARN/MISSING/UNMAPPED/null — from the
   * latest Analyze run's broadened target-schema check, so the Mapping Editor can
   * flag "needs attention" rows without a second round trip.
   */
  app.get("/projects/:id/mappings", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await getOwnedProject(req.userId!, id))) {
      return reply.code(404).send({ error: "project not found" });
    }

    const [rows, analyze] = await Promise.all([
      prisma.mappingDefinition.findMany({
        where: { projectId: id },
        orderBy: [{ enabled: "desc" }, { object: "asc" }],
        select: {
          id: true,
          object: true,
          target: true,
          fieldMap: true,
          enabled: true,
          confidence: true,
          autoDrafted: true,
        },
      }),
      prisma.stageRun.findFirst({ where: { projectId: id, stage: "analyze" }, orderBy: { createdAt: "desc" } }),
    ]);

    const outcomeByTarget = new Map<string, string>();
    if (analyze) {
      // Check rows share role="target" with the full inventory rows but are never
      // "target:"-prefixed — see apps/worker/src/jobs/analyze.ts.
      const checkRuns = await prisma.objectRun.findMany({
        where: { stageRunId: analyze.id, role: "target", NOT: { objectApiName: { startsWith: "target:" } } },
        select: { objectApiName: true, checkpoint: true },
      });
      for (const c of checkRuns) {
        const outcome = (c.checkpoint as { outcome?: string } | null)?.outcome ?? "PASS";
        outcomeByTarget.set(c.objectApiName, outcome);
      }
    }

    return rows.map((r) => ({
      ...r,
      targetOutcome: r.target ? (outcomeByTarget.get(r.target) ?? null) : null,
    }));
  });

  /** Edit a single mapping: set its target, field map, and/or enabled flag. */
  app.patch("/projects/:id/mappings/:mappingId", async (req, reply) => {
    const { id, mappingId } = req.params as { id: string; mappingId: string };
    if (!(await getOwnedProject(req.userId!, id))) {
      return reply.code(404).send({ error: "project not found" });
    }
    // Confirm the mapping belongs to this project (IDOR guard).
    const existing = await prisma.mappingDefinition.findFirst({
      where: { id: mappingId, projectId: id },
    });
    if (!existing) return reply.code(404).send({ error: "mapping not found" });

    const body = (req.body ?? {}) as {
      target?: string | null;
      fieldMap?: Record<string, string>;
      enabled?: boolean;
    };
    if (body.enabled === true && !(body.target ?? existing.target)) {
      return reply.code(400).send({ error: "cannot enable a mapping with no target object" });
    }

    // Any operator edit marks the row USER-OWNED (autoDrafted=false) so a later
    // re-run of Analyze preserves it instead of overwriting with a fresh draft.
    // See docs/sprint_four_planning/04-curation-and-suggestions.md.
    const data: Prisma.MappingDefinitionUpdateInput = { autoDrafted: false };
    if (body.target !== undefined) data.target = body.target;
    if (body.fieldMap !== undefined) data.fieldMap = body.fieldMap as Prisma.InputJsonValue;
    if (body.enabled !== undefined) data.enabled = body.enabled;

    return prisma.mappingDefinition.update({ where: { id: mappingId }, data });
  });

  /**
   * Everything the field-map editor needs for one mapping, pulled from the latest
   * Analyze run's captured metadata (object_run.checkpoint.fields — persisted in
   * Postgres but stripped from the analyze stage response): the source object's
   * fields, the current target object's fields, and the full list of target objects
   * (for re-picking the target). No extra Salesforce calls.
   */
  app.get("/projects/:id/mappings/:mappingId/schema", async (req, reply) => {
    const { id, mappingId } = req.params as { id: string; mappingId: string };
    if (!(await getOwnedProject(req.userId!, id))) {
      return reply.code(404).send({ error: "project not found" });
    }
    const mapping = await prisma.mappingDefinition.findFirst({
      where: { id: mappingId, projectId: id },
    });
    if (!mapping) return reply.code(404).send({ error: "mapping not found" });

    const analyze = await prisma.stageRun.findFirst({
      where: { projectId: id, stage: "analyze" },
      orderBy: { createdAt: "desc" },
    });
    if (!analyze) {
      return reply.code(400).send({ error: "run Analyze first to capture schema metadata" });
    }

    type FieldMeta = { name: string; label: string; type: string };
    const fieldsOf = (checkpoint: unknown): FieldMeta[] => {
      const raw = (checkpoint as { fields?: unknown })?.fields;
      if (!Array.isArray(raw)) return [];
      return raw.map((f) => {
        const fm = f as Partial<FieldMeta>;
        return { name: fm.name ?? "", label: fm.label ?? "", type: fm.type ?? "" };
      });
    };

    const sourceRun = await prisma.objectRun.findFirst({
      where: { stageRunId: analyze.id, role: "source", objectApiName: mapping.object },
      select: { checkpoint: true },
    });

    let target: { object: string; fields: FieldMeta[] } | null = null;
    if (mapping.target) {
      const targetRun = await prisma.objectRun.findFirst({
        where: {
          stageRunId: analyze.id,
          role: "target",
          objectApiName: `target:${mapping.target}`,
        },
        select: { checkpoint: true },
      });
      target = { object: mapping.target, fields: fieldsOf(targetRun?.checkpoint) };
    }

    const targetRuns = await prisma.objectRun.findMany({
      where: { stageRunId: analyze.id, role: "target", objectApiName: { startsWith: "target:" } },
      select: { objectApiName: true, checkpoint: true },
      orderBy: { objectApiName: "asc" },
    });
    const targetObjects = targetRuns.map((r) => ({
      name: r.objectApiName.replace(/^target:/, ""),
      label: (r.checkpoint as { label?: string })?.label ?? "",
    }));

    return {
      source: { object: mapping.object, fields: fieldsOf(sourceRun?.checkpoint) },
      target,
      targetObjects,
    };
  });
}
