import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { prisma } from "@opennpc/db";
import { createBoss, QUEUES, type PgBoss } from "@opennpc/core";
import { authHook, authRoutes } from "./auth.js";
import { projectRoutes } from "./routes/projects.js";
import { oauthRoutes } from "./routes/oauth.js";
import { connectionRoutes } from "./routes/connections.js";
import { stageRoutes } from "./routes/stages.js";
import { mappingRoutes } from "./routes/mappings.js";

const PORT = Number(process.env.API_PORT ?? 3001);

/**
 * Allowed browser origins for the web UI. The web app (default :3000) is a
 * different origin than the api (:3001), so CORS must be enabled or the browser
 * blocks the UI from reading responses. Override with WEB_ORIGIN (comma-separated).
 * Multi-tenant auth uses a cookie, so CORS must also allow credentials — that
 * requires an explicit origin (not `true`/wildcard) per the Fetch/CORS spec.
 */
const WEB_ORIGIN = process.env.WEB_ORIGIN?.split(",").map((s) => s.trim()) ?? [
  process.env.WEB_APP_URL ?? "http://localhost:3000",
];

const app = Fastify({ logger: true });

// pg-boss instance used by the api to enqueue jobs for the worker.
let boss: PgBoss;

app.get("/health", async () => {
  // Verify Postgres connectivity (state + staging + queue all live here).
  await prisma.$queryRaw`SELECT 1`;
  return { status: "ok", service: "api", time: new Date().toISOString() };
});

/**
 * Milestone 1 smoke test: enqueue a no-op job and let the worker process it.
 * Proves the api -> pg-boss (Postgres) -> worker round-trip works.
 */
app.post("/dev/enqueue-noop", async (request) => {
  const payload = (request.body as Record<string, unknown> | undefined) ?? {};
  const jobId = await boss.send(QUEUES.NOOP, { ...payload, enqueuedAt: Date.now() });
  return { enqueued: true, queue: QUEUES.NOOP, jobId };
});

async function main(): Promise<void> {
  await app.register(cors, { origin: WEB_ORIGIN, credentials: true });
  await app.register(cookie);

  // Populate req.userId from the session cookie on every request (non-rejecting;
  // individual routes opt into requiring auth via the `requireAuth` preHandler).
  app.addHook("onRequest", authHook);

  // Queue is needed by stage routes (and /dev/enqueue-noop), so start it first.
  boss = createBoss();
  boss.on("error", (err: Error) => app.log.error(err, "pg-boss error"));
  await boss.start();

  // Multi-tenant: signup/login/logout/me.
  await app.register(authRoutes);
  // Milestone 2: projects + ECA OAuth connect + capability probe.
  await app.register(projectRoutes);
  await app.register(oauthRoutes);
  await app.register(connectionRoutes);
  // Milestone 3: stage control (Extract). Pass the started queue via a closure.
  await app.register(async (a) => stageRoutes(a, boss));
  // Dynamic mapping layer: view/edit the analysis-seeded mappings.
  await app.register(mappingRoutes);

  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`api listening on :${PORT}`);
}

async function shutdown(): Promise<void> {
  await app.close();
  await boss?.stop();
  await prisma.$disconnect();
}

process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
