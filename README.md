# OpenNPC Migration Platform

Free, open-source platform to migrate a Salesforce **Nonprofit Success Pack (NPSP)** org into a
**Nonprofit Cloud (NPC)** org through a guided, restartable, 5-stage workflow.

> 📚 **Full design docs:** [docs/](docs/) — start with [docs/README.md](docs/README.md),
> then [docs/04-migration-workflow.md](docs/04-migration-workflow.md) (the state machine) and
> [docs/05-data-model-mapping.md](docs/05-data-model-mapping.md) (NPSP→NPC mapping).

## Status

**Milestone 1 — Foundation** (runnable spine; no migration logic yet). See the roadmap in
[docs/13-roadmap-and-milestones.md](docs/13-roadmap-and-milestones.md).

## Stack

Node.js + TypeScript · jsforce · PostgreSQL · **pg-boss** (Postgres-backed queue, no Redis) ·
Prisma · Fastify (api) · Next.js (web) · pnpm workspaces · Docker Compose.

## Repository layout

```
apps/
  web/      Next.js UI
  api/      Fastify REST + state-machine controller
  worker/   pg-boss job consumers
packages/
  db/         Prisma schema + client (the tables in docs/06)
  core/       state machine, types, queue helper
  salesforce/ jsforce wrappers (stubs in M1)
  mapping/    transformation engine + mappings (stubs in M1)
docs/         product requirements documentation
```

See [docs/15-repository-structure.md](docs/15-repository-structure.md) for details.

## Quick start (Docker)

```bash
cp .env.example .env       # optional for compose; compose has dev defaults
docker compose up --build  # starts postgres + api + worker + web
```

- Web UI: http://localhost:3000
- API health: http://localhost:3001/health
- Smoke test the queue: click **"Enqueue no-op job"** in the UI (or
  `curl -X POST http://localhost:3001/dev/enqueue-noop`) and watch the **worker** logs print
  `processed noop job …`. This proves the api → pg-boss (Postgres) → worker round-trip.

## Local dev (without Docker)

Prereqs: Node 20+, pnpm (`corepack enable`), a Postgres instance.

```bash
pnpm install
cp .env.example .env        # set DATABASE_URL
pnpm db:generate            # generate Prisma client
pnpm db:push                # create tables
pnpm test                   # unit tests (state machine)
pnpm --filter @opennpc/worker dev   # terminal 1
pnpm --filter @opennpc/api dev      # terminal 2
pnpm --filter @opennpc/web dev      # terminal 3
```

## License

MIT (proposed). See [docs/16-contributing.md](docs/16-contributing.md).
