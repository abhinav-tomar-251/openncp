import { createBoss, QUEUES, type PgBoss } from "@opennpc/core";
import { runExtractPlan, runExtractObject } from "./jobs/extract.js";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4);

type NoopData = { enqueuedAt?: number; [k: string]: unknown };

let boss: PgBoss;

/** Normalize a pg-boss work callback arg across versions (single job vs array). */
function asJobs<T>(job: unknown): { id: string; data: T }[] {
  return (Array.isArray(job) ? job : [job]) as { id: string; data: T }[];
}

async function main(): Promise<void> {
  boss = createBoss();
  boss.on("error", (err: Error) => console.error("[worker] pg-boss error", err));
  await boss.start();

  // Milestone 1 smoke handler: proves jobs enqueued by the api are processed here.
  await boss.work<NoopData>(
    QUEUES.NOOP,
    { teamSize: CONCURRENCY },
    async (job) => {
      // Normalize across pg-boss versions (single job vs batch array).
      const jobs = Array.isArray(job) ? job : [job];
      for (const j of jobs) {
        const latencyMs = j.data?.enqueuedAt ? Date.now() - j.data.enqueuedAt : null;
        console.log(
          `[worker] processed ${QUEUES.NOOP} job ${j.id}` +
            (latencyMs !== null ? ` (latency ${latencyMs}ms)` : ""),
        );
      }
    },
  );

  // Milestone 3: Extract stage.
  await boss.work<{ stageRunId: string }>(QUEUES.EXTRACT_PLAN, async (job) => {
    for (const j of asJobs<{ stageRunId: string }>(job)) {
      console.log(`[worker] extract.plan stageRun=${j.data.stageRunId}`);
      await runExtractPlan(boss, j.data.stageRunId);
    }
  });

  await boss.work<{ objectRunId: string }>(
    QUEUES.EXTRACT_OBJECT,
    { teamSize: CONCURRENCY },
    async (job) => {
      for (const j of asJobs<{ objectRunId: string }>(job)) {
        console.log(`[worker] extract.object objectRun=${j.data.objectRunId}`);
        await runExtractObject(j.data.objectRunId);
      }
    },
  );

  console.log(`[worker] started; listening on queues: ${Object.values(QUEUES).join(", ")}`);
}

async function shutdown(): Promise<void> {
  await boss?.stop();
}

process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
