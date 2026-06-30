/**
 * Milestone 1 smoke test: prove a job round-trips through pg-boss (Postgres-backed).
 * Uses the same createBoss/QUEUES that apps/api (enqueue) and apps/worker (consume) use.
 *
 * Run: DATABASE_URL=... pnpm dlx tsx scripts/smoke-queue.ts
 */
import { createBoss, QUEUES } from "../packages/core/src/index.js";

async function main(): Promise<void> {
  const boss = createBoss();
  boss.on("error", (e) => console.error("pg-boss error", e));
  await boss.start();

  let processed = false;
  await boss.work(QUEUES.NOOP, async (job) => {
    const jobs = Array.isArray(job) ? job : [job];
    for (const j of jobs) console.log(`[consume] processed job ${j.id}`, j.data);
    processed = true;
  });

  const id = await boss.send(QUEUES.NOOP, { hello: "world", enqueuedAt: Date.now() });
  console.log(`[enqueue] sent job ${id} to "${QUEUES.NOOP}"`);

  const deadline = Date.now() + 10_000;
  while (!processed && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }

  await boss.stop({ graceful: false });
  console.log(processed ? "ROUNDTRIP_OK" : "ROUNDTRIP_FAIL");
  process.exit(processed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
