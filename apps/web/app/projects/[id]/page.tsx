"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API_BASE, apiGet, apiPost, card, btn } from "../../lib/api";
import { useSession } from "../../lib/useSession";

type Capability = {
  orgId: string | null;
  username?: string;
  organizationName?: string;
  apiVersion?: string;
  personAccountsEnabled?: boolean;
  npspInstalled?: boolean;
  enhancedRecurringDonations?: boolean;
  pmmInstalled?: boolean;
  npcFundraisingPresent?: boolean;
  dailyApiRequests?: { max: number; remaining: number };
  blockers?: string[];
  warnings?: string[];
  error?: string;
};

type Connection = {
  role: "source" | "target";
  instanceUrl: string;
  orgId: string | null;
  apiVersion: string | null;
  tokenMeta?: { capability?: Capability; loginUrl?: string };
  updatedAt: string;
};

type Project = { id: string; name: string; connections: Connection[] };

const ROLES: { role: "source" | "target"; label: string; hint: string }[] = [
  { role: "source", label: "Source — NPSP org", hint: "The Nonprofit Success Pack org to migrate FROM (read-only)." },
  { role: "target", label: "Target — NPC org", hint: "The Nonprofit Cloud org to migrate INTO." },
];

export default function ProjectPage() {
  const params = useParams();
  const id = String(params.id);
  const { user, loading: sessionLoading } = useSession();
  const [project, setProject] = useState<Project | null>(null);
  const [banner, setBanner] = useState("");

  async function load() {
    setProject(await apiGet<Project>(`/projects/${id}`));
  }

  // Only fetch the (auth-scoped) project once we know who's signed in.
  useEffect(() => {
    if (!user) return;
    void load();
    const connected = new URLSearchParams(window.location.search).get("connected");
    if (connected) setBanner(`Connected ${connected} org ✓`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user]);

  if (sessionLoading) return <main style={wrap}>Loading…</main>;
  if (!user) return null; // redirecting to /login
  if (!project) return <main style={wrap}>Loading…</main>;

  const byRole = (r: string) => project.connections.find((c) => c.role === r);

  return (
    <main style={wrap}>
      <Link href="/" style={{ color: "#93c5fd" }}>
        ← All projects
      </Link>
      <h1 style={{ marginBottom: 4 }}>{project.name}</h1>
      <p style={{ color: "#9aa4c0", marginTop: 0 }}>Stage 1 · Connect &amp; Analyze</p>
      {banner && (
        <div style={{ ...card, borderColor: "#22c55e", color: "#86efac" }}>{banner}</div>
      )}

      {ROLES.map(({ role, label, hint }) => (
        <ConnectCard
          key={role}
          projectId={id}
          role={role}
          label={label}
          hint={hint}
          connection={byRole(role)}
          onChanged={load}
        />
      ))}

      <AnalyzePanel projectId={id} enabled={!!byRole("source")} />

      <section style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <strong>Mapping Editor</strong>
          <div style={{ color: "#9aa4c0", fontSize: 13 }}>
            Review &amp; edit the NPSP→NPC mappings drafted at Analyze — set targets, map fields, and
            enable objects to migrate. Enabled mappings drive Transform &amp; Load.
          </div>
        </div>
        <Link href={`/projects/${id}/mappings`} style={{ ...btn, whiteSpace: "nowrap" }}>
          Open editor →
        </Link>
      </section>

      <StagePanel
        projectId={id}
        stage="extract"
        noun="Extract"
        title="Stage 2 · Extract"
        desc="Bulk API 2.0 pulls each in-scope source object into staging."
        enabled={!!byRole("source")}
        enabledHint="Connect a source org first."
      />

      <StagePanel
        projectId={id}
        stage="transform"
        noun="Transform"
        title="Stage 3 · Transform"
        desc="Map NPSP → NPC into staging and build the ID cross-reference."
        enabled={true}
      >
        <PrepareTarget projectId={id} target={byRole("target")} onChanged={load} />
      </StagePanel>

      <StagePanel
        projectId={id}
        stage="load"
        noun="Load"
        title="Stage 4 · Load"
        desc="Idempotent Bulk 2.0 upsert into NPC by external id; captures new record IDs into id_xref."
        enabled={!!byRole("target")}
        enabledHint="Connect the target NPC org first (and run Prepare target schema)."
      />

      <ValidatePanel projectId={id} enabled={!!byRole("target")} />
    </main>
  );
}

type ObjectRun = {
  id: string;
  objectApiName: string;
  status: string;
  processedCount: number;
  failedCount: number;
};
type StageData = {
  id?: string;
  status: string;
  stats?: { objects?: number; [k: string]: unknown };
  objectRuns: ObjectRun[];
};

function StagePanel({
  projectId,
  stage,
  noun,
  title,
  desc,
  enabled,
  enabledHint,
  children,
}: {
  projectId: string;
  stage: string;
  noun: string;
  title: string;
  desc: string;
  enabled: boolean;
  enabledHint?: string;
  children?: React.ReactNode;
}) {
  const [data, setData] = useState<StageData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function refresh() {
    try {
      setData(await apiGet<StageData>(`/projects/${projectId}/stages/${stage}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, stage]);

  // Poll while the stage is in flight.
  useEffect(() => {
    const active = data?.status === "RUNNING" || data?.status === "QUEUED";
    if (!active) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.status]);

  async function run() {
    setBusy(true);
    setErr("");
    try {
      await apiPost(`/projects/${projectId}/stages/${stage}/run`);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function retry(objectRunId: string) {
    try {
      await apiPost(`/projects/${projectId}/objects/${objectRunId}/retry`);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function approve() {
    setErr("");
    try {
      await apiPost(`/projects/${projectId}/stages/${stage}/approve`);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const objects = data?.objectRuns ?? [];
  const done = objects.filter((o) => o.status === "COMPLETED").length;
  const awaitingReview = data?.status === "AWAITING_REVIEW";

  return (
    <section style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>{title}</strong>
        <span style={{ color: "#9aa4c0" }}>{data?.status ?? "NOT_STARTED"}</span>
      </div>
      <div style={{ color: "#9aa4c0", fontSize: 13, margin: "4px 0 12px" }}>{desc}</div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button style={btn} onClick={run} disabled={!enabled || busy}>
          {busy ? "Starting…" : `${objects.length ? "Re-run" : "Run"} ${noun}`}
        </button>
        {awaitingReview && (
          <button style={{ ...btn, background: "#16a34a" }} onClick={approve}>
            Approve →
          </button>
        )}
        {!enabled && enabledHint && (
          <span style={{ color: "#9aa4c0", fontSize: 13 }}>{enabledHint}</span>
        )}
      </div>
      <StatsLine stats={data?.stats} />
      {children}
      {err && <p style={{ color: "#f87171" }}>{err}</p>}

      {objects.length > 0 && (
        <>
          <div style={{ margin: "12px 0 6px", color: "#9aa4c0", fontSize: 13 }}>
            {done}/{objects.length} objects complete
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "#9aa4c0", textAlign: "left" }}>
                <th style={{ padding: "4px 6px" }}>Object</th>
                <th style={{ padding: "4px 6px" }}>Status</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>Records</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {objects.map((o) => (
                <tr key={o.id} style={{ borderTop: "1px solid #283157" }}>
                  <td style={{ padding: "4px 6px" }}>
                    <code>{o.objectApiName}</code>
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <StatusPill status={o.status} />
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>
                    {o.processedCount.toLocaleString()}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>
                    {o.status === "FAILED" && (
                      <button
                        onClick={() => retry(o.id)}
                        style={{ ...btn, background: "#334155", padding: "2px 8px" }}
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/** Renders any stage stats beyond the plain object count (e.g. userMatch results). */
function StatsLine({ stats }: { stats?: { objects?: number; [k: string]: unknown } }) {
  if (!stats) return null;
  const extra = Object.entries(stats).filter(([k]) => k !== "objects");
  if (extra.length === 0) return null;
  return (
    <div style={{ fontSize: 12, color: "#9aa4c0", marginTop: 6 }}>
      {extra.map(([k, v]) => (
        <span key={k} style={{ marginRight: 12 }}>
          {k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}
        </span>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, [string, string]> = {
    COMPLETED: ["#14532d", "#86efac"],
    RUNNING: ["#1e3a5f", "#93c5fd"],
    PENDING: ["#3f3f46", "#d4d4d8"],
    PARTIAL: ["#422006", "#fbbf24"],
    FAILED: ["#3f1d1d", "#fca5a5"],
  };
  const [bg, fg] = colors[status] ?? ["#3f3f46", "#d4d4d8"];
  return (
    <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 8px", fontSize: 12 }}>
      {status}
    </span>
  );
}

function ConnectCard({
  projectId,
  role,
  label,
  hint,
  connection,
  onChanged,
}: {
  projectId: string;
  role: "source" | "target";
  label: string;
  hint: string;
  connection?: Connection;
  onChanged: () => Promise<void>;
}) {
  const [sandbox, setSandbox] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const cap = connection?.tokenMeta?.capability;

  const connectHref =
    `${API_BASE}/oauth/start?projectId=${encodeURIComponent(projectId)}&role=${role}` +
    (sandbox ? "&sandbox=true" : "");

  async function reprobe() {
    setBusy(true);
    setErr("");
    try {
      await apiPost(`/projects/${projectId}/connections/${role}/probe`);
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>{label}</strong>
        <span style={{ color: connection ? "#86efac" : "#9aa4c0" }}>
          {connection ? "Connected" : "Not connected"}
        </span>
      </div>
      <div style={{ color: "#9aa4c0", fontSize: 13, margin: "4px 0 12px" }}>{hint}</div>

      {!connection && (
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a style={btn} href={connectHref}>
            Connect
          </a>
          <label style={{ color: "#9aa4c0", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={sandbox}
              onChange={(e) => setSandbox(e.target.checked)}
            />{" "}
            Sandbox login
          </label>
        </div>
      )}

      {connection && (
        <div>
          <div style={{ fontSize: 13, color: "#cbd5e1" }}>
            Org: <code>{connection.orgId ?? "—"}</code> · {connection.instanceUrl} · API v
            {connection.apiVersion}
          </div>
          {cap?.error ? (
            <p style={{ color: "#f87171" }}>Probe error: {cap.error}</p>
          ) : (
            <CapabilityView role={role} cap={cap} />
          )}
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <a style={{ ...btn, background: "#334155" }} href={connectHref}>
              Re-connect
            </a>
            <button style={btn} onClick={reprobe} disabled={busy}>
              {busy ? "Probing…" : "Re-probe"}
            </button>
          </div>
          {err && <p style={{ color: "#f87171" }}>{err}</p>}
        </div>
      )}
    </section>
  );
}

function CapabilityView({ role, cap }: { role: "source" | "target"; cap?: Capability }) {
  if (!cap) return <p style={{ color: "#9aa4c0" }}>No capability data.</p>;
  const checks: { label: string; ok: boolean; show: boolean }[] = [
    { label: "Person Accounts enabled", ok: !!cap.personAccountsEnabled, show: role === "target" },
    { label: "NPC Fundraising present", ok: !!cap.npcFundraisingPresent, show: role === "target" },
    { label: "NPSP installed", ok: !!cap.npspInstalled, show: role === "source" },
    { label: "Enhanced Recurring Donations", ok: !!cap.enhancedRecurringDonations, show: role === "source" },
    { label: "Program Management (PMM)", ok: !!cap.pmmInstalled, show: true },
  ];
  return (
    <div style={{ marginTop: 8 }}>
      {cap.organizationName && (
        <div style={{ fontSize: 13, color: "#cbd5e1" }}>
          {cap.organizationName} · {cap.username}
        </div>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: "8px 0", display: "flex", flexWrap: "wrap", gap: 8 }}>
        {checks
          .filter((c) => c.show)
          .map((c) => (
            <li
              key={c.label}
              style={{
                fontSize: 12,
                padding: "3px 8px",
                borderRadius: 999,
                background: c.ok ? "#14532d" : "#3f1d1d",
                color: c.ok ? "#86efac" : "#fca5a5",
              }}
            >
              {c.ok ? "✓" : "✗"} {c.label}
            </li>
          ))}
      </ul>
      {cap.dailyApiRequests && (
        <div style={{ fontSize: 12, color: "#9aa4c0" }}>
          Daily API: {cap.dailyApiRequests.remaining.toLocaleString()} /{" "}
          {cap.dailyApiRequests.max.toLocaleString()} remaining
        </div>
      )}
      {cap.blockers?.map((b) => (
        <div key={b} style={{ color: "#f87171", fontSize: 13, marginTop: 4 }}>
          ⛔ {b}
        </div>
      ))}
      {cap.warnings?.map((w) => (
        <div key={w} style={{ color: "#fbbf24", fontSize: 13, marginTop: 4 }}>
          ⚠ {w}
        </div>
      ))}
    </div>
  );
}

type ReconcileRow = {
  id: string;
  objectApiName: string;
  status: string;
  checkpoint?: {
    sourceObject?: string;
    expectedCount?: number;
    loadedCount?: number;
    errorCount?: number;
    liveCount?: number;
    localSum?: number | null;
    liveSum?: number | null;
    outcome?: "PASS" | "PARTIAL" | "FAIL";
    notes?: string[];
  };
};
type ValidateStage = { status: string; objectRuns: ReconcileRow[] };

function ValidatePanel({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const [data, setData] = useState<ValidateStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function refresh() {
    try {
      setData(await apiGet<ValidateStage>(`/projects/${projectId}/stages/validate`));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    const active = data?.status === "RUNNING" || data?.status === "QUEUED";
    if (!active) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.status]);

  async function run() {
    setBusy(true);
    setErr("");
    try {
      await apiPost(`/projects/${projectId}/stages/validate/run`);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setErr("");
    try {
      await apiPost(`/projects/${projectId}/stages/validate/approve`);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const rows = data?.objectRuns ?? [];
  const awaitingReview = data?.status === "AWAITING_REVIEW";

  return (
    <section style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>Stage 5 · Validate</strong>
        <span style={{ color: "#9aa4c0" }}>{data?.status ?? "NOT_STARTED"}</span>
      </div>
      <div style={{ color: "#9aa4c0", fontSize: 13, margin: "4px 0 12px" }}>
        Reconciles local records against a live read-back from the target org, plus financial totals
        where configured.
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button style={btn} onClick={run} disabled={!enabled || busy}>
          {busy ? "Starting…" : `${rows.length ? "Re-run" : "Run"} Validate`}
        </button>
        {awaitingReview && (
          <button style={{ ...btn, background: "#16a34a" }} onClick={approve}>
            Approve →
          </button>
        )}
        {!enabled && (
          <span style={{ color: "#9aa4c0", fontSize: 13 }}>Connect the target NPC org first.</span>
        )}
        {rows.length > 0 && (
          <a
            style={{ ...btn, background: "#334155" }}
            href={`${API_BASE}/projects/${projectId}/report?format=csv`}
          >
            Download report (CSV)
          </a>
        )}
      </div>
      {err && <p style={{ color: "#f87171" }}>{err}</p>}

      {rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 12 }}>
          <thead>
            <tr style={{ color: "#9aa4c0", textAlign: "left" }}>
              <th style={{ padding: "4px 6px" }}>Object</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>Expected</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>Loaded</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>Errors</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>Live count</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>Local sum</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>Live sum</th>
              <th style={{ padding: "4px 6px" }}>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const c = r.checkpoint ?? {};
              return (
                <tr key={r.id} style={{ borderTop: "1px solid #283157" }} title={c.notes?.join(" ")}>
                  <td style={{ padding: "4px 6px" }}>
                    <code>{r.objectApiName}</code>
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{c.expectedCount ?? "—"}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{c.loadedCount ?? "—"}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{c.errorCount ?? "—"}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{c.liveCount ?? "—"}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>
                    {c.localSum != null ? c.localSum.toFixed(2) : "—"}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>
                    {c.liveSum != null ? c.liveSum.toFixed(2) : "—"}
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <OutcomePill outcome={r.status === "FAILED" ? "FAIL" : (c.outcome ?? "FAIL")} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

type SourceObjectRow = {
  id: string;
  objectApiName: string;
  role: "source" | "target" | null;
  status: string;
  processedCount: number;
  checkpoint?: {
    label?: string;
    custom?: boolean;
    fieldCount?: number;
    exists?: boolean;
    missingFields?: string[];
    suggestions?: string[];
    suggestionDetails?: { name: string; fields: string[] }[];
    outcome?: "PASS" | "WARN" | "MISSING";
  };
};
type AnalyzeStage = {
  status: string;
  stats?: {
    sourceObjects?: number;
    sourceWithData?: number;
    targetChecked?: number;
    targetIssues?: number;
    targetObjectsFound?: number;
    targetWithData?: number;
  };
  objectRuns: SourceObjectRow[];
};

/**
 * Stage 1 · Analyze — discovers what each org actually contains, before Extract
 * or Transform ever assume a fixed object/mapping list. Bespoke (not the generic
 * StagePanel) because source/target results need two distinct table shapes.
 */
function AnalyzePanel({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const [data, setData] = useState<AnalyzeStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function refresh() {
    try {
      setData(await apiGet<AnalyzeStage>(`/projects/${projectId}/stages/analyze`));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    const active = data?.status === "RUNNING" || data?.status === "QUEUED";
    if (!active) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.status]);

  async function run() {
    setBusy(true);
    setErr("");
    try {
      await apiPost(`/projects/${projectId}/stages/analyze/run`);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setErr("");
    try {
      await apiPost(`/projects/${projectId}/stages/analyze/approve`);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const sourceRows = (data?.objectRuns ?? []).filter((o) => o.role === "source");
  // Target rows come in two shapes sharing role="target": the narrow schema check
  // (against objects our mappings actually reference) and the full org inventory
  // (prefixed "target:" to keep them unambiguous from the schema-check rows even
  // when they name the same object, e.g. both may list "Account").
  const targetCheckRows = (data?.objectRuns ?? []).filter(
    (o) => o.role === "target" && !o.objectApiName.startsWith("target:"),
  );
  const targetInventoryRows = (data?.objectRuns ?? []).filter((o) =>
    o.objectApiName.startsWith("target:"),
  );
  const awaitingReview = data?.status === "AWAITING_REVIEW";

  return (
    <section style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>Stage 1 · Analyze</strong>
        <span style={{ color: "#9aa4c0" }}>{data?.status ?? "NOT_STARTED"}</span>
      </div>
      <div style={{ color: "#9aa4c0", fontSize: 13, margin: "4px 0 12px" }}>
        Discovers every object actually in the source org (not a fixed list) and confirms the target
        org's schema before Extract/Transform run. Required before Extract.
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button style={btn} onClick={run} disabled={!enabled || busy}>
          {busy ? "Starting…" : `${sourceRows.length ? "Re-run" : "Run"} Analyze`}
        </button>
        {awaitingReview && (
          <button style={{ ...btn, background: "#16a34a" }} onClick={approve}>
            Approve →
          </button>
        )}
        {!enabled && (
          <span style={{ color: "#9aa4c0", fontSize: 13 }}>Connect the source NPSP org first.</span>
        )}
      </div>
      {err && <p style={{ color: "#f87171" }}>{err}</p>}

      {sourceRows.length > 0 && (
        <>
          <div style={{ margin: "12px 0 6px", color: "#9aa4c0", fontSize: 13 }}>
            Source objects found: {data?.stats?.sourceObjects ?? sourceRows.length} (
            {data?.stats?.sourceWithData ?? sourceRows.filter((r) => r.processedCount > 0).length} with
            records)
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid #283157", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "#9aa4c0", textAlign: "left", position: "sticky", top: 0, background: "#151b33" }}>
                  <th style={{ padding: "4px 6px" }}>Object</th>
                  <th style={{ padding: "4px 6px" }}>Type</th>
                  <th style={{ padding: "4px 6px", textAlign: "right" }}>Records</th>
                  <th style={{ padding: "4px 6px", textAlign: "right" }}>Fields</th>
                </tr>
              </thead>
              <tbody>
                {sourceRows.map((o) => (
                  <tr key={o.id} style={{ borderTop: "1px solid #283157" }}>
                    <td style={{ padding: "4px 6px" }}>
                      <code>{o.objectApiName}</code>
                      {o.checkpoint?.label && (
                        <span style={{ color: "#9aa4c0" }}> — {o.checkpoint.label}</span>
                      )}
                    </td>
                    <td style={{ padding: "4px 6px", color: "#9aa4c0" }}>
                      {o.checkpoint?.custom ? "custom" : "standard"}
                    </td>
                    <td style={{ padding: "4px 6px", textAlign: "right" }}>
                      {o.processedCount.toLocaleString()}
                    </td>
                    <td style={{ padding: "4px 6px", textAlign: "right", color: "#9aa4c0" }}>
                      {o.checkpoint?.fieldCount ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {targetCheckRows.length > 0 && (
        <>
          <div style={{ margin: "16px 0 6px", color: "#9aa4c0", fontSize: 13 }}>
            Target schema check: {data?.stats?.targetChecked ?? targetCheckRows.length} objects,{" "}
            {data?.stats?.targetIssues ?? 0} issue(s)
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "#9aa4c0", textAlign: "left" }}>
                <th style={{ padding: "4px 6px" }}>Object</th>
                <th style={{ padding: "4px 6px" }}>Outcome</th>
                <th style={{ padding: "4px 6px" }}>Missing fields / suggestions</th>
              </tr>
            </thead>
            <tbody>
              {targetCheckRows.map((o) => (
                <tr key={o.id} style={{ borderTop: "1px solid #283157" }}>
                  <td style={{ padding: "4px 6px" }}>
                    <code>{o.objectApiName}</code>
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <OutcomePill
                      outcome={
                        o.checkpoint?.outcome === "MISSING"
                          ? "FAIL"
                          : o.checkpoint?.outcome === "WARN"
                            ? "PARTIAL"
                            : "PASS"
                      }
                    />
                    {o.checkpoint?.outcome === "MISSING" && (
                      <span style={{ color: "#9aa4c0", marginLeft: 6 }}>object not found in target</span>
                    )}
                  </td>
                  <td style={{ padding: "4px 6px", color: "#9aa4c0" }}>
                    {o.checkpoint?.outcome === "MISSING" ? (
                      o.checkpoint?.suggestionDetails?.length ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {o.checkpoint.suggestionDetails.map((s) => (
                            <div key={s.name}>
                              <code style={{ color: "#e6e9f2" }}>{s.name}</code>
                              {s.fields.length > 0 && (
                                <div
                                  style={{
                                    maxHeight: 70,
                                    overflowY: "auto",
                                    marginTop: 2,
                                    fontSize: 12,
                                  }}
                                >
                                  {s.fields.join(", ")}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        "no similarly-named objects found"
                      )
                    ) : (
                      o.checkpoint?.missingFields?.join(", ") || "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {targetInventoryRows.length > 0 && (
        <>
          <div style={{ margin: "16px 0 6px", color: "#9aa4c0", fontSize: 13 }}>
            Target objects available: {data?.stats?.targetObjectsFound ?? targetInventoryRows.length} (
            {data?.stats?.targetWithData ?? targetInventoryRows.filter((r) => r.processedCount > 0).length}{" "}
            with records) — full inventory of the NPC org, for browsing/future mapping work.
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid #283157", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "#9aa4c0", textAlign: "left", position: "sticky", top: 0, background: "#151b33" }}>
                  <th style={{ padding: "4px 6px" }}>Object</th>
                  <th style={{ padding: "4px 6px" }}>Type</th>
                  <th style={{ padding: "4px 6px", textAlign: "right" }}>Records</th>
                  <th style={{ padding: "4px 6px", textAlign: "right" }}>Fields</th>
                </tr>
              </thead>
              <tbody>
                {targetInventoryRows.map((o) => (
                  <tr key={o.id} style={{ borderTop: "1px solid #283157" }}>
                    <td style={{ padding: "4px 6px" }}>
                      <code>{o.objectApiName.replace(/^target:/, "")}</code>
                      {o.checkpoint?.label && (
                        <span style={{ color: "#9aa4c0" }}> — {o.checkpoint.label}</span>
                      )}
                    </td>
                    <td style={{ padding: "4px 6px", color: "#9aa4c0" }}>
                      {o.checkpoint?.custom ? "custom" : "standard"}
                    </td>
                    <td style={{ padding: "4px 6px", textAlign: "right" }}>
                      {o.processedCount.toLocaleString()}
                    </td>
                    <td style={{ padding: "4px 6px", textAlign: "right", color: "#9aa4c0" }}>
                      {o.checkpoint?.fieldCount ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function OutcomePill({ outcome }: { outcome: string }) {
  const colors: Record<string, [string, string]> = {
    PASS: ["#14532d", "#86efac"],
    PARTIAL: ["#422006", "#fbbf24"],
    FAIL: ["#3f1d1d", "#fca5a5"],
  };
  const [bg, fg] = colors[outcome] ?? colors.FAIL!;
  return (
    <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 8px", fontSize: 12 }}>
      {outcome}
    </span>
  );
}

function PrepareTarget({
  projectId,
  target,
  onChanged,
}: {
  projectId: string;
  target?: Connection;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const prep = (
    target?.tokenMeta as unknown as { targetPrep?: { at: string; results: PrepResult[] } } | undefined
  )?.targetPrep;

  async function run() {
    setBusy(true);
    setMsg("Preparing… (creating external-ID fields via Metadata API)");
    try {
      await apiPost(`/projects/${projectId}/prepare-target`);
      // The worker runs this asynchronously; refresh once it's had time to finish.
      setTimeout(() => {
        void onChanged();
        setMsg("");
        setBusy(false);
      }, 5000);
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div style={{ margin: "10px 0 2px", padding: 12, border: "1px dashed #283157", borderRadius: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13 }}>
          Target schema prep — create <code>Legacy_NPSP_Id__c</code> external-ID fields
        </span>
        <button
          style={{ ...btn, background: "#334155", padding: "4px 10px" }}
          onClick={run}
          disabled={!target || busy}
        >
          {busy ? "Preparing…" : "Prepare target schema"}
        </button>
      </div>
      {!target && (
        <div style={{ color: "#9aa4c0", fontSize: 12, marginTop: 6 }}>
          Connect the target NPC org first.
        </div>
      )}
      {msg && <div style={{ color: "#9aa4c0", fontSize: 12, marginTop: 6 }}>{msg}</div>}
      {prep && (
        <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "flex", flexWrap: "wrap", gap: 8 }}>
          {prep.results.map((r) => (
            <li
              key={r.object}
              title={r.message}
              style={{
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 999,
                background: r.outcome === "error" ? "#3f1d1d" : "#14532d",
                color: r.outcome === "error" ? "#fca5a5" : "#86efac",
              }}
            >
              {r.outcome === "error" ? "✗" : "✓"} {r.object} ({r.outcome})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type PrepResult = { object: string; field: string; outcome: string; message?: string };

const wrap: React.CSSProperties = { maxWidth: 760, margin: "0 auto", padding: "48px 24px" };
