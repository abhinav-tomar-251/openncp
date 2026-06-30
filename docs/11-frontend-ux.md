# 11 · Frontend & UX

[← API & Jobs](10-api-and-jobs.md) · [Index](README.md) · Next: [Security →](12-security.md)

---

The UI (Next.js + React) is a **guided, gated migration console**. Its job is to make a complex,
long-running, finance-sensitive process feel transparent and controllable. Every stage shows
progress, ends in a review gate, and supports re-running.

## 1. Information architecture

```
/                       Projects list
/projects/new           Create project
/projects/:id           Migration console (stage rail + active stage panel)
  ├─ /connect           Connect source & target orgs
  ├─ /analyze           Readiness report + mapping editor
  ├─ /extract           Extract dashboard
  ├─ /transform         Transform dashboard + target-prep plan
  ├─ /load              Load dashboard + errors
  └─ /validate          Reconciliation report + go-live checklist
/projects/:id/errors    Cross-stage error explorer
/projects/:id/report    Migration report (export)
```

## 2. The migration console (primary screen)

A persistent **stage rail** on the left shows the 5 stages with status badges; the main panel shows
the active stage. This makes the state machine visible at all times.

```
┌──────────────────────────────────────────────────────────────────┐
│  OpenNPC · Project: "Acme Foundation"            [Source ✓][Target ✓]│
├───────────────┬──────────────────────────────────────────────────┤
│ ① Analyze  ✓  │   STAGE 3 · TRANSFORM                  RUNNING �inreview│
│ ② Extract  ✓  │   ───────────────────────────────────────────────  │
│ ③ Transform ▶ │   Object              Status      Done    Errors    │
│ ④ Load     ·  │   Person Account      COMPLETED   76,543  0         │
│ ⑤ Validate ·  │   Gift Transaction    RUNNING ▓▓▓▓░ 61%   12 ▸      │
│               │   Gift Commitment     PENDING    —       —          │
│  [Re-run]     │   Designation         COMPLETED  144     0          │
│  [View errors]│                                                     │
│               │   ┌ Review gate (when complete) ───────────────┐   │
│               │   │ Sample transformed records · Errors · Plan  │   │
│               │   │            [ Re-run ]   [ Approve → Load ]   │   │
│               │   └─────────────────────────────────────────────┘   │
└───────────────┴──────────────────────────────────────────────────┘
```

## 3. Key screens

### Connect orgs
- Two cards: **Source (NPSP)** and **Target (NPC)**, each with a "Connect" button launching ECA
  OAuth. After connect: org name, instance, API limits, and a capability check (Person Accounts
  enabled? NPC objects present? PMM installed?).

### Analyze — readiness report + mapping editor
- **Readiness report:** record counts per object, detected NPSP config (account model, Enhanced RD),
  installed packages, API-limit risk, and any **blockers** (e.g. Person Accounts not enabled).
- **Mapping editor:** per object, a table of `source field → target field` with value-map sub-rows
  for picklists. Inline validation flags unresolved target fields/values. Operators can edit, reset
  to default, and save as a reusable template. This is the most interaction-heavy screen.

### Extract / Transform / Load dashboards
- Per-object rows with live progress bars (driven by the SSE event stream), counts, and error
  badges. Click an object to see its checkpoint, Bulk job id, and errors.
- **Re-run** (whole stage) and **Retry** (single object / failed records) buttons.
- Transform additionally shows the **target-schema change plan** (fields/record types/picklists to
  be created) for approval before anything is created in the target org.

### Errors explorer
- Cross-stage, filterable by object and `retryable`. Each row: source id, message, payload preview
  (PII-masked), and a retry action. Bulk-select to retry many.

### Validate — reconciliation report
- The reconciliation table (source vs target counts and totals) with PASS/FAIL badges, the financial
  totals comparison, discrepancy drill-down, the manual go-live checklist, and an **Export report**
  button (HTML/CSV/JSON).

## 4. Review-gate pattern

Every stage panel renders a **review gate** when the stage reaches `AWAITING_REVIEW`:

- Shows the gate artifact (samples / counts / errors / plan / reconciliation).
- Two primary actions: **Approve →** (advance) and **Re-run** (back to QUEUED).
- Approval captures who/when (shown in an audit trail), satisfying the transparency principle.

## 5. UX principles

- **Always show state.** The stage rail and per-object statuses make the durable state machine
  legible; nothing happens invisibly.
- **Safe by default.** Destructive-feeling actions (running Load, creating target fields) require an
  explicit gate approval; the source org is clearly labeled read-only everywhere.
- **Resumable feel.** Closing the browser and returning shows exactly where things stand — all state
  lives in Postgres, not the client.
- **Progress honesty.** Progress bars reflect real `processed/total` from the worker; errors are
  never hidden behind a green checkmark.

## 6. Tech notes

- Next.js App Router; server components for data fetches, client components for the live dashboards.
- Real-time updates via the `GET /projects/:id/events` SSE stream (fallback: polling).
- A small design-system (e.g. Radix UI + Tailwind) for accessible tables, dialogs, and badges.
- No Salesforce credentials ever touch the browser — the UI only calls the `api`.
