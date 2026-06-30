# 12 · Security

[← Frontend & UX](11-frontend-ux.md) · [Index](README.md) · Next: [Roadmap & Milestones →](13-roadmap-and-milestones.md)

---

OpenNPC handles two production Salesforce orgs and their donor PII. Security is a first-class
requirement, not an afterthought.

## 1. Source-org read-only guarantee

- The platform **never writes to the source org**. Source operations are limited to read APIs
  (Bulk query, `describe`, `COUNT()`).
- Enforced in code: the `packages/salesforce` source connection is constructed with a **read-only
  wrapper** that throws on any ingest/DML call. Defense in depth: the source ECA scope and
  integration user should be configured read-only where possible.
- The UI labels the source org as read-only everywhere to set operator expectations.

## 2. Token & secret handling

- **Refresh tokens are encrypted at rest** with AES-256-GCM (`org_connection.refresh_token_enc`).
  The encryption key comes from a deployment secret (env var or secrets manager), never from the
  database or source.
- Access tokens are short-lived; the connection wrapper refreshes them on demand and keeps them in
  memory, encrypted if persisted.
- **PKCE** is used on the OAuth Authorization Code exchange to protect against code interception.
- App-level secrets (ECA client secret, DB credentials, encryption key) are supplied via environment
  / secrets manager and are **never** committed or logged.
- Key rotation: support re-encrypting stored tokens under a new key (a maintenance command) without
  re-authorizing orgs where possible.

## 3. Least privilege

- ECA OAuth scopes limited to what each role needs: `api refresh_token offline_access` — read for
  source, read+write for target. No broader scopes.
- The target integration user holds only the permission sets/licenses required to write the in-scope
  NPC objects.

## 4. PII-aware logging

- Donor data (names, emails, gift amounts) is PII. Logs default to **structured, minimal** output:
  ids and counts, not record bodies.
- `migration_error.payload` stores the offending record for retry/debugging but is **masked in the
  UI** (emails/phones partially redacted) and access-controlled.
- No tokens, secrets, or full record payloads are ever written at `info` level.

## 5. Multi-tenant isolation (if hosted for others)

- Default deployment is **single-tenant self-host** (one org pair per deployment) — the simplest,
  safest mode.
- If run as a shared service: every table is `project_id`-scoped; queries are always filtered by the
  authenticated user's projects; tokens are per-connection encrypted; workers must not leak
  connections across projects. Row-level isolation should be enforced at the data-access layer.

## 6. Transport & deployment

- All external traffic over TLS (Salesforce APIs are HTTPS; serve the UI/API behind TLS).
- The `worker` needs outbound HTTPS to Salesforce but no inbound exposure.
- Postgres should not be publicly exposed; restrict to the app network. Back up the database
  (it contains encrypted tokens + PII staging) with encryption at rest.

## 7. Data lifecycle & minimization

- Staging tables hold a **copy of donor PII** during migration. Provide an **"archive/purge
  project"** action that drops `staging_source`/`staging_target` once a migration is validated and
  complete, retaining only non-PII audit (`stage_run`, `object_run`, counts, `id_xref` ids).
- Document a retention policy; default to purging staging PII promptly after go-live.

## 8. Auditability

- Every review-gate approval records who and when (`stage_run.approved_by/at`).
- Every stage/object run, retry, and error is persisted — a complete, reconstructable history of
  what was migrated, when, and by whom. This satisfies the transparency principle and supports
  post-migration audits.

## 9. Threat-model highlights

| Threat | Mitigation |
|--------|------------|
| Stolen DB backup | Tokens encrypted (AES-256-GCM); key held outside DB; staging PII purged after go-live |
| Accidental source write | Read-only source connection wrapper + read-only scope/user |
| OAuth code interception | PKCE; short-lived codes; exact redirect URI |
| Secret leakage via logs | PII/secret-aware logging; no payloads/tokens at info level |
| Cross-project data bleed (multi-tenant) | `project_id` scoping enforced at data layer; per-connection tokens |
| Over-broad target writes | Least-privilege integration user + scoped permission sets |
