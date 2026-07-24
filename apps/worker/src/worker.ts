import { createBoss, QUEUES, type PgBoss } from "@opennpc/core";
import { runAnalyzePlan } from "./jobs/analyze.js";
import { runExtractPlan, runExtractObject } from "./jobs/extract.js";
import { runTransformPlan, runTransformObject } from "./jobs/transform.js";
import { runPrepareTarget } from "./jobs/prepareTarget.js";
import { runLoadPlan, runLoadObject } from "./jobs/load.js";
import { runValidatePlan, runValidateObject } from "./jobs/validate.js";

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

  // Analyze stage: discover what each org actually has, before Extract/Transform
  // assume anything. No per-object queue — a describe+count pass runs inline.
  await boss.work<{ stageRunId: string }>(QUEUES.ANALYZE_SCHEMA, async (job) => {
    for (const j of asJobs<{ stageRunId: string }>(job)) {
      console.log(`[worker] analyze.plan stageRun=${j.data.stageRunId}`);
      await runAnalyzePlan(j.data.stageRunId);
    }
  });

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

  // Milestone 4: Transform stage + target-schema prep.
  await boss.work<{ stageRunId: string }>(QUEUES.TRANSFORM_PLAN, async (job) => {
    for (const j of asJobs<{ stageRunId: string }>(job)) {
      console.log(`[worker] transform.plan stageRun=${j.data.stageRunId}`);
      await runTransformPlan(boss, j.data.stageRunId);
    }
  });

  await boss.work<{ objectRunId: string }>(
    QUEUES.TRANSFORM_OBJECT,
    { teamSize: CONCURRENCY },
    async (job) => {
      for (const j of asJobs<{ objectRunId: string }>(job)) {
        console.log(`[worker] transform.object objectRun=${j.data.objectRunId}`);
        await runTransformObject(j.data.objectRunId);
      }
    },
  );

  await boss.work<{ projectId: string }>(QUEUES.PREPARE_TARGET, async (job) => {
    for (const j of asJobs<{ projectId: string }>(job)) {
      console.log(`[worker] prepare.target project=${j.data.projectId}`);
      await runPrepareTarget(j.data.projectId);
    }
  });

  // Milestone 5: Load stage (dependency-ordered, chained).
  await boss.work<{ stageRunId: string }>(QUEUES.LOAD_PLAN, async (job) => {
    for (const j of asJobs<{ stageRunId: string }>(job)) {
      console.log(`[worker] load.plan stageRun=${j.data.stageRunId}`);
      await runLoadPlan(boss, j.data.stageRunId);
    }
  });

  await boss.work<{ objectRunId: string }>(QUEUES.LOAD_OBJECT, async (job) => {
    for (const j of asJobs<{ objectRunId: string }>(job)) {
      console.log(`[worker] load.object objectRun=${j.data.objectRunId}`);
      await runLoadObject(boss, j.data.objectRunId);
    }
  });

  // Milestone 6: Validate stage (read-only reconciliation).
  await boss.work<{ stageRunId: string }>(QUEUES.VALIDATE_PLAN, async (job) => {
    for (const j of asJobs<{ stageRunId: string }>(job)) {
      console.log(`[worker] validate.plan stageRun=${j.data.stageRunId}`);
      await runValidatePlan(boss, j.data.stageRunId);
    }
  });

  await boss.work<{ objectRunId: string }>(
    QUEUES.VALIDATE_RECONCILE,
    { teamSize: CONCURRENCY },
    async (job) => {
      for (const j of asJobs<{ objectRunId: string }>(job)) {
        console.log(`[worker] validate.reconcile objectRun=${j.data.objectRunId}`);
        await runValidateObject(j.data.objectRunId);
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
