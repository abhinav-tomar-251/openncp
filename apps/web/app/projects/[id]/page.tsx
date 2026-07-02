"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API_BASE, apiGet, apiPost, card, btn } from "../../lib/api";

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
  const [project, setProject] = useState<Project | null>(null);
  const [banner, setBanner] = useState("");

  async function load() {
    setProject(await apiGet<Project>(`/projects/${id}`));
  }

  useEffect(() => {
    void load();
    const connected = new URLSearchParams(window.location.search).get("connected");
    if (connected) setBanner(`Connected ${connected} org ✓`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

      <ExtractPanel projectId={id} enabled={!!byRole("source")} />
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
type ExtractStage = { id?: string; status: string; stats?: { objects?: number }; objectRuns: ObjectRun[] };

function ExtractPanel({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const [stage, setStage] = useState<ExtractStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function refresh() {
    try {
      setStage(await apiGet<ExtractStage>(`/projects/${projectId}/stages/extract`));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Poll while the stage is in flight.
  useEffect(() => {
    const active = stage?.status === "RUNNING" || stage?.status === "QUEUED";
    if (!active) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage?.status]);

  async function run() {
    setBusy(true);
    setErr("");
    try {
      await apiPost(`/projects/${projectId}/stages/extract/run`);
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

  const objects = stage?.objectRuns ?? [];
  const done = objects.filter((o) => o.status === "COMPLETED").length;

  return (
    <section style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>Stage 2 · Extract</strong>
        <span style={{ color: "#9aa4c0" }}>{stage?.status ?? "NOT_STARTED"}</span>
      </div>
      <div style={{ color: "#9aa4c0", fontSize: 13, margin: "4px 0 12px" }}>
        Bulk API 2.0 pulls each in-scope source object into staging.
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button style={btn} onClick={run} disabled={!enabled || busy}>
          {busy ? "Starting…" : objects.length ? "Re-run Extract" : "Run Extract"}
        </button>
        {!enabled && <span style={{ color: "#9aa4c0", fontSize: 13 }}>Connect a source org first.</span>}
      </div>
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

const wrap: React.CSSProperties = { maxWidth: 760, margin: "0 auto", padding: "48px 24px" };
