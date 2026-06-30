# 14 · Testing Strategy

[← Roadmap & Milestones](13-roadmap-and-milestones.md) · [Index](README.md) · Next: [Repository Structure →](15-repository-structure.md)

---

The product's whole value is **correctness and recoverability** of a finance-sensitive migration, so
testing emphasizes deterministic transforms, idempotent loads, and resume-after-failure behavior.

## 1. Test layers

| Layer | Scope | Tooling |
|-------|-------|---------|
| **Unit** | Pure functions: transform modules, mapping engine, value maps, `id_xref` resolution, state-machine guards | Vitest/Jest |
| **Integration** | A stage running against a real Postgres (Testcontainers) + a mocked Salesforce, exercising pg-boss jobs end-to-end | Vitest + Testcontainers + nock/msw |
| **End-to-end** | Full 5-stage run against two **real Salesforce test orgs** with seeded data | Playwright (UI) + scripted runner |
| **Robustness** | Failure injection: kill worker mid-load, retry, rerun-one-stage, bad-record handling | Integration harness |
| **Scale** | High-volume extract/load with PK chunking and checkpointing | Seeded scratch org / generated data |

## 2. Deterministic transform tests (the core)

Because the engine is pure (same input + mapping → same output), transforms are exhaustively
unit-tested with fixtures:

- Given a fixture NPSP `Opportunity` + `npe01__OppPayment__c[]`, assert the produced
  `GiftTransaction` (+ installments) matches the expected snapshot for each `paymentSplit` option.
- Household → Person Account: single-member and multi-member fixtures; assert Person Account fields
  and `PartyRelationshipGroup` members.
- Recurring Donation: classic and Enhanced fixtures → `GiftCommitment` + `GiftCommitmentSchedule`.
- Value maps: every picklist translation has a positive and a "value missing in target" case.
- `id_xref` resolution: lookups resolve; unresolved lookups raise a validation error.

## 3. Two-org test setup (e2e)

1. **Source NPSP org** — a Developer Edition / trial with NPSP installed, seeded with a realistic but
   small dataset: a few hundred Households, Contacts, Donations + Payments, Recurring Donations,
   GAUs/Allocations, soft credits, relationships, affiliations, campaigns (and PMM if testing
   Programs).
2. **Target NPC org** — a trial with Person Accounts + Nonprofit Cloud (Fundraising) enabled.
3. Seed scripts (idempotent) live in `test/fixtures/seed/` so any contributor can recreate the
   dataset.
4. The e2e runner drives the platform through all five stages and asserts the reconciliation report
   is PASS.

## 4. Robustness tests (the differentiators)

These prove the durable-state-machine claims:

| Test | Procedure | Assertion |
|------|-----------|-----------|
| **Resume mid-load** | Start Load; kill the worker at ~50%; restart. | Load resumes from `object_run.checkpoint`; **upserts produce no duplicates**; final count correct. |
| **Rerun one stage** | After a full run, edit a mapping; re-run **only Transform**, then Load. | Extract is untouched; changed records re-loaded via upsert; no duplicates; reconciliation still PASS. |
| **Bad record isolation** | Inject a record that violates a target validation. | Record lands in `migration_error` (retryable); the rest of the object loads; a targeted retry clears it. |
| **Object-level retry** | Force one object's job to fail. | Only that object is `FAILED`; retrying it doesn't touch sibling objects. |
| **API-limit backoff** | Simulate `REQUEST_LIMIT_EXCEEDED`. | Job retries with backoff (pg-boss) and eventually completes; no data loss. |

## 5. Scale test

- Generate ~100k+ `Opportunity` records in a scratch org (or mock the Bulk API at that scale).
- Run Extract + Load and assert: PK chunking engages, memory stays bounded (streaming, not loading
  all rows into memory), checkpoints advance, and a mid-run kill resumes correctly.

## 6. Mocking Salesforce for fast CI

- A `FakeSalesforce` implementation of the `packages/salesforce` interfaces backs integration tests:
  in-memory Bulk query/upsert with external-ID semantics, `describe` fixtures, and limit responses.
- This lets the full pipeline (pg-boss jobs, state machine, transforms, reconciliation) run in CI in
  seconds without a live org, while e2e tests cover the real-org behavior on a schedule.

## 7. CI pipeline

- On every PR: lint, typecheck, unit + integration tests (Postgres via Testcontainers, mocked
  Salesforce). Fast and hermetic.
- Nightly / on-demand: e2e against the two real test orgs (credentials from CI secrets), plus the
  scale test.
- Coverage focus: transform modules and the state machine are the highest-value code to keep at high
  coverage.

## 8. What "green" must mean before a scope ships

Per [13-roadmap-and-milestones.md](13-roadmap-and-milestones.md) §4: unit tests for the transform,
an integration test through the pipeline, an idempotency assertion on Load, and a passing
reconciliation check on the test dataset.
