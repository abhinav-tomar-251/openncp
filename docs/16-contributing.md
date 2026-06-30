# 16 · Contributing

[← Repository Structure](15-repository-structure.md) · [Index](README.md)

---

OpenNPC is open source and contribution-first. The most valuable contributions are **new/refined
object mappings** and **transform modules**, because that is how the platform grows to cover more
NPSP configurations and keeps pace with NPC's evolving schema.

## 1. License

Proposed: **MIT** (permissive, maximizes adoption for nonprofits and SIs). Apache-2.0 is an
acceptable alternative if explicit patent grants are preferred. Finalize before first public release
and add a `LICENSE` file at the repo root.

## 2. Local development setup

Prerequisites: Node.js 20, pnpm, Docker.

```bash
git clone <repo-url> npsp2npc && cd npsp2npc
pnpm install
cp .env.example .env            # fill in DATABASE_URL, APP_ENCRYPTION_KEY, ECA creds
docker compose up -d postgres   # or `docker compose up` for the whole stack
pnpm db:migrate                 # apply Prisma migrations
pnpm dev                        # run web + api + worker locally
pnpm test                       # unit + integration (Postgres via Testcontainers, mocked Salesforce)
```

You do **not** need real Salesforce orgs to develop or run the test suite — the `FakeSalesforce`
implementation backs integration tests. Real orgs are only needed for e2e (see
[14-testing-strategy.md](14-testing-strategy.md)).

## 3. How to add a new object mapping (most common contribution)

1. Add a default mapping file: `packages/mapping/defaults/<source-object>.yaml` (see the format in
   [08-transformation-engine.md](08-transformation-engine.md)).
2. If the conversion is a pure field/value map, you're done — the engine picks it up.
3. If it's a model change (merge/split/derive), add a **transform module** in
   `packages/mapping/transforms/` implementing `(sourceRecords, ctx) => targetRecords` and register
   it by target name.
4. Add **fixtures + unit tests** under `test/fixtures/` covering the field map, value maps, and any
   edge cases (missing values, multi-record merges).
5. Add the object to the relevant **scope** and to the **load dependency order** in
   [05-data-model-mapping.md](05-data-model-mapping.md) if it introduces new ordering needs.
6. Ensure **idempotency**: the target object gets `Legacy_NPSP_Id__c` and Load upserts on it.

## 4. How to add a validator

Register a validator hook in `packages/mapping/validators/` keyed on the target object. It receives a
transformed record + context and returns `ok` or a structured error (which becomes a
`migration_error`). Keep validators pure and well-tested.

## 5. Coding standards

- TypeScript strict mode; no `any` in package public APIs.
- Pure, deterministic transforms — no wall-clock/random in output (see
  [08-transformation-engine.md](08-transformation-engine.md) §7).
- Validate external input with Zod at boundaries (API requests, mapping definitions).
- Never log tokens, secrets, or full record payloads at `info` (see [12-security.md](12-security.md)).
- The **source org is read-only** — never add a write path against a source connection.

## 6. Pull-request process

1. Open an issue describing the change (especially for new object scopes or mapping decisions).
2. Branch from `main`; keep PRs focused (one object scope / one concern).
3. Include tests; `pnpm lint`, `pnpm typecheck`, and `pnpm test` must pass in CI.
4. For data-model decisions, document the mapping rationale in the PR (and update
   [05-data-model-mapping.md](05-data-model-mapping.md) if the canonical mapping changes).
5. A maintainer reviews for correctness, idempotency, and test coverage before merge.

## 7. Areas that especially welcome contributions

- Additional NPSP configurations (1×1 and Bucket account models, legacy recurring donations).
- Edge-case transforms (complex soft-credit/tribute scenarios, partial allocations).
- NPC schema updates (confirming/adjusting target object & field names as NPC evolves).
- Performance work for very large orgs (1M+ records).
- Localization of the UI and reports.

## 8. Community

- Use issues for bugs/feature requests and discussions for design proposals.
- Add a `CODE_OF_CONDUCT.md` (Contributor Covenant) before public launch.
- Be transparent about mapping decisions — nonprofits depend on the financial accuracy of this tool.
