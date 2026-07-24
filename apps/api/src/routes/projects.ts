import type { FastifyInstance } from "fastify";
import { prisma, type Prisma } from "@opennpc/db";
import { requireAuth } from "../auth.js";
import { getOwnedProject } from "../lib/ownership.js";

/** Non-secret connection fields safe to return to the UI (never token bytes). */
const connectionSelect = {
  id: true,
  role: true,
  instanceUrl: true,
  orgId: true,
  apiVersion: true,
  tokenMeta: true,
  updatedAt: true,
} satisfies Prisma.OrgConnectionSelect;

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/projects", async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; scope?: Record<string, unknown> };
    const name = body.name?.trim();
    if (!name) return reply.code(400).send({ error: "name is required" });
    return prisma.migrationProject.create({
      data: { name, ownerId: req.userId, scope: (body.scope ?? {}) as Prisma.InputJsonValue },
    });
  });

  app.get("/projects", async (req) => {
    return prisma.migrationProject.findMany({
      where: { ownerId: req.userId },
      orderBy: { createdAt: "desc" },
      include: { connections: { select: connectionSelect } },
    });
  });

  app.get("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const owned = await getOwnedProject(req.userId!, id);
    if (!owned) return reply.code(404).send({ error: "project not found" });
    const project = await prisma.migrationProject.findUnique({
      where: { id },
      include: { connections: { select: connectionSelect } },
    });
    return project;
  });
}
