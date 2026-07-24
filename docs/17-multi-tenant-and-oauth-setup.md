# 17 · Multi-Tenant & Cross-Org OAuth Setup

[← Contributing](16-contributing.md) · [Index](README.md)

> Goal: let **any user** connect **any** NPSP and **any** NPC org and migrate — the
> SaaS/ISV model — instead of one app locked to one org. This has two parts:
> **(A)** a cross-org-capable OAuth app (a Salesforce-side setup), and **(B)** the
> multi-tenant application layer (our code + infra). Part A is what unblocks
> "connect any org"; Part B is what makes it safe for many users.

---

## Why the current block happens

An **External Client App (ECA)** created as **Local** only authorizes users of the
org it was created in. Using an NPSP-org app to log into a *different* NPC org is a
cross-org flow, which Salesforce blocks:
`OAUTH_AUTHORIZATION_BLOCKED — Cross-org OAuth flows are not supported`.

Our platform code is already org-agnostic: it runs the standard Authorization Code +
PKCE flow, takes `instance_url` from the token, and stores per-connection encrypted
tokens. The only thing missing is an app whose **consumer key is usable across orgs.**

---

## Part A — A cross-org OAuth app

### Maturity ladder (pick where you are)

| Stage | App approach | Cross-org? | Effort |
|-------|--------------|:---------:|--------|
| **Local dev / testing (now)** | One **Local ECA per org** (our `SF_ECA_SOURCE_*` / `SF_ECA_TARGET_*` fallback) | works because each org uses its own app | lowest |
| **Beta** | One **Distributed (packaged) ECA** | ✅ any org | medium |
| **Production SaaS / AppExchange** | Managed-package ECA + Security Review | ✅ any org, listed | high |

> The dev approach already works today with the per-role vars — use it to keep
> building. Move to a distributed app when you want real "any user, any org."

### A.1 Option 1 — Distributed External Client App (recommended, modern)

> ⚠️ ECA distribution/packaging is a **newer, evolving** Salesforce feature. The
> steps below are the correct shape; confirm exact click-paths and metadata names
> against the current Salesforce docs: search "External Client Apps" +
> "Package and Distribute an External Client App".

**Prerequisites**
- A **Dev Hub** org (Setup → Dev Hub → Enable Dev Hub).
- **Salesforce CLI** (`sf`) installed and authenticated to the Dev Hub.
- (Optional) a **namespace** org if you want a managed package.

**Steps**
1. **Create the ECA** in your packaging org: Setup → **External Client App Manager**
   → **New External Client App**.
   - Basic info: name, contact email.
   - **OAuth** enabled; **Callback URL** = your product's public callback
     (e.g. `https://app.yourdomain.com/oauth/callback`; `http://localhost:3001/oauth/callback`
     for dev). You can register multiple callback URLs.
   - **Scopes:** `api`, `refresh_token`, `offline_access` (add `web` if needed).
   - Policies: enable **refresh token rotation** as desired; PKCE required (we send it).
2. **Mark it for distribution / packaging** — set the app's distribution so it is
   **Packaged** (not Local). This is the setting that lets its consumer key be used
   outside the home org.
3. **Package it (2GP)** with the CLI, including the ECA metadata
   (`ExternalClientApplication`, `ExtlClntAppOauthSettings`, `ExtlClntAppGlobalOauthSettings`):
   ```bash
   sf package create --name "OpenNPC" --package-type Unlocked --path force-app
   sf package version create --package "OpenNPC" --installation-key-bypass --wait 20 --code-coverage
   sf package version promote --package "OpenNPC@x.y.z"
   ```
4. **Distribute:** share the install URL (or list on AppExchange). Depending on the
   current model, customer orgs either **install the package** or authorize via the
   **consent screen** — verify which applies for cross-org OAuth in the current docs.
5. **Use one consumer key everywhere:** put the distributed app's key/secret in the
   shared `SF_ECA_CLIENT_ID` / `SF_ECA_CLIENT_SECRET`. Every org (source or target)
   now connects with this single app.

### A.2 Option 2 — Connected App (simplest cross-org, if your org still allows it)

Classic **Connected Apps** have a **globally-usable consumer key by default** — any
org's user can OAuth-consent without installing anything (exactly the SaaS model).
Salesforce has been **restricting creation of new Connected Apps** (pushing ECAs),
but many orgs can still enable it: Setup → search **"Connected Apps OAuth Usage"** /
**"Allow creation of connected apps"**.
- Create a Connected App with OAuth, the callback URL, and scopes above.
- Set **"Permitted Users" = All users may self-authorize** and relax IP as needed.
- Its consumer key works cross-org immediately → put it in `SF_ECA_CLIENT_ID/SECRET`.

Use this only if your org permits new Connected Apps; otherwise use Option 1.

### A.3 Production OAuth requirements (both options)
- **Public HTTPS callback URL** on your domain (localhost is dev-only). Register it
  in the app and set `SF_OAUTH_REDIRECT_URI` + `WEB_APP_URL` to the public URLs.
- **Login host:** `https://login.salesforce.com` for production orgs,
  `https://test.salesforce.com` for sandboxes (our "Sandbox login" toggle already
  routes this). Users pick their org by logging in.
- Least privilege: source connection uses `api refresh_token offline_access` and is
  treated **read-only** in code; target adds write scope.

---

## Part B — Multi-tenant application layer (our code)

Today the app has **no user accounts** — projects are global (fine for single-org
self-host). To serve many users safely we add authentication + tenant isolation.

### B.1 Tenant model
- **v1 (recommended start): user-as-tenant.** Each signed-up `User` owns their
  `MigrationProject`s and org connections. Simple, covers most solo admins/consultants.
- **v2: Workspaces/Teams.** Add `Tenant` + `Membership(user, tenant, role)` so a
  consulting firm can share projects. Projects belong to a `tenantId`.

### B.2 Data model changes (Prisma)
```
User        { id, email (unique), passwordHash, name, createdAt }
Session     { id, userId, expiresAt }            // if using DB sessions
// v2: Tenant { id, name }, Membership { userId, tenantId, role }
MigrationProject += ownerId (v1)  // or tenantId (v2)  -> scope EVERYTHING by this
OAuthState  += userId              // tie the OAuth flow to the initiating user
```
- Every read/write is filtered by the authenticated user's `ownerId`/`tenantId`.
- Cascade deletes so removing a user removes their projects/connections/staging.

### B.3 Authentication
- **Recommended (OSS-friendly, dependency-light):** email + password hashed with
  **argon2**, session issued as an **httpOnly, secure cookie** (JWT or DB session)
  by the Fastify api; the web attaches it to API calls. Add social/SSO later.
- **Faster alternative:** a hosted auth provider (Clerk / Auth0 / WorkOS) — less code,
  external dependency, not fully self-hostable.
- A Fastify **auth hook (`preHandler`)** validates the session on every non-public
  route and sets `req.userId`; routes reject unauthenticated requests (401).

### B.4 Authorization & isolation (the critical part)
- **All project/connection/stage/error/report routes** require auth and filter by the
  owner — a user can only see/act on their own projects.
- **OAuth flow must be authenticated:** `/oauth/start` requires login and verifies the
  user owns the target project; `oauth_state` stores `userId`; `/oauth/callback`
  attaches the org only to that user's project. (Prevents "attach my org to your
  project" attacks.)
- **Worker isolation:** jobs already run by `projectId`; since projects are
  owner-scoped and tokens are per-connection, the worker naturally stays within a
  tenant. Never share a jsforce connection across projects.
- **Optional hardening:** Postgres **Row-Level Security** keyed on tenant as
  defense-in-depth.

### B.5 Secrets & data lifecycle
- Refresh tokens already **AES-256-GCM encrypted** at rest. For stronger isolation,
  derive a per-tenant data key from the master `APP_ENCRYPTION_KEY`.
- Never log tokens or record payloads (see [12-security.md](12-security.md)).
- **Per-tenant purge:** an "archive/delete project" action that drops that project's
  `staging_source`/`staging_target` (donor PII) after go-live, keeping only audit.

### B.6 Fairness & limits
- Salesforce API limits are **per connected org**, so tenants are naturally isolated
  on that axis. Add **per-tenant worker concurrency caps** in pg-boss so one large
  migration doesn't starve others.

### B.7 Production infrastructure
- Public domain + **TLS** for web and api; the OAuth callback must be HTTPS.
- Managed **PostgreSQL** with backups (holds encrypted tokens + PII staging).
- `APP_ENCRYPTION_KEY`, ECA client id/secret in a **secrets manager** (not `.env`).
- Scale `worker` replicas; Postgres is the coordination point (pg-boss).

---

## Decisions locked
- **OAuth app:** Distributed (packaged) External Client App → single shared
  `SF_ECA_CLIENT_ID/SECRET` for all orgs.
- **App auth:** Built-in **email + password** (argon2 hash) with an httpOnly cookie
  session issued by the Fastify api. No external auth provider.
- **Tenant model:** **User-as-tenant** (each user owns their projects/connections);
  teams/workspaces deferred to v2.

## Implementation plan (the "Multi-Tenant" milestone)

1. **Prisma:** add `User` (+ `Session`), `ownerId` on `MigrationProject`, `userId` on
   `OAuthState`; migration.
2. **api:** signup/login/logout routes (argon2 + cookie session); auth `preHandler`;
   scope every existing route by `req.userId`; authenticate `/oauth/start` &
   validate project ownership.
3. **web:** login/signup pages; send credentials with API calls; gate the app behind auth.
4. **worker:** no logic change (project-scoped), but assert project ownership when
   resolving connections.
5. **Docs/tests:** isolation tests (user A cannot access user B's project/connection).

---

## Verification checklist (do this before Milestone 5)

**Cross-org OAuth (Part A)**
- [ ] With **one** app's `SF_ECA_CLIENT_ID/SECRET`, connect an **NPSP** org *and* a
      **different NPC** org — both succeed (no `OAUTH_AUTHORIZATION_BLOCKED`).
- [ ] Sandbox toggle routes to `test.salesforce.com` and connects a sandbox.
- [ ] Callback URL used is the one registered in the app.

**Multi-tenant (Part B, after we build it)**
- [ ] Two app users; user A **cannot** see or act on user B's projects/connections
      (API returns 401/404, not another tenant's data).
- [ ] `/oauth/start` rejects unauthenticated calls and calls for projects you don't own.
- [ ] Tokens remain encrypted at rest; source connection rejects writes.
- [ ] Deleting a user/project purges their staging PII.

---

## TL;DR
- **To connect any org today:** keep per-org dev apps, or publish **one distributed
  ECA** (or a Connected App if your org still allows it) and use the single
  `SF_ECA_CLIENT_ID/SECRET`. This is a **Salesforce-side** setup — our code is ready.
- **To serve many users safely:** add the **multi-tenant milestone** (auth + owner
  scoping + authenticated OAuth). Small, well-scoped, and independent of the
  migration engine.
