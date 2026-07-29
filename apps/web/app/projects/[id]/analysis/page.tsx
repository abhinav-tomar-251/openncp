"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiGet, downloadFile } from "../../../lib/api";
import { useSession } from "../../../lib/useSession";
import { AppHeader } from "../../../components/AppHeader";
import { SeverityPill, OutcomePill, ConfidencePill, CapFlag } from "../../../components/pills";
import { findTranslation, TranslationHint } from "../../../components/TranslationDiagram";

// --- Report types (mirror apps/api/src/lib/analysisReport.ts) ---
type FieldMeta = {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  unique?: boolean;
  externalId?: boolean;
  calculated?: boolean;
  picklistValues?: { value: string }[];
  referenceTo?: string[];
};
type ReportObject = {
  name: string;
  label: string;
  custom: boolean;
  count: number;
  fields: FieldMeta[];
  recordTypes: { name: string }[];
  childRelationships: { childSObject: string; field: string }[];
  lookups: { field: string; referenceTo: string[] }[];
};
type Warning = {
  severity: "info" | "warn" | "blocker";
  kind: string;
  object?: string;
  message: string;
  why?: string;
  action?: string;
};
type Config = {
  validationRules: { object: string; name: string; active: boolean }[];
  flows: { apiName: string; label: string; triggerObject: string | null }[];
  apexTriggers: { name: string; object: string; events: string[] }[];
  tdtmHandlers: { className: string; object: string; trigger: string; active: boolean }[];
  workflowRules: { object: string; name: string }[];
  duplicateRules: { object: string; name: string; active: boolean }[];
  npspSettings: Record<string, Record<string, unknown>[]>;
  skipped: { kind: string; reason: string }[];
} | null;
type MappedByEntry = { source: string; enabled: boolean; confidence: string };
type TargetReadinessRow = {
  object: string;
  label: string;
  count: number;
  fieldCount: number;
  exists: boolean;
  missingFields: string[];
  suggestions: string[];
  outcome: "PASS" | "WARN" | "MISSING" | "UNMAPPED";
  mappedBy: MappedByEntry[];
};
type TargetSummary = { total: number; mapped: number; unmapped: number; issuesEnabled: number; issuesUnreviewed: number };
type AnalysisReport = {
  meta: {
    projectName: string;
    generatedAt: string;
    analyzedAt: string | null;
    source: { orgId: string | null; instanceUrl: string; apiVersion: string | null } | null;
    capability: Record<string, unknown> | null;
  };
  source: { objectCount: number; objectsWithData: number; totalRecords: number; objects: ReportObject[]; config: Config };
  targetReadiness: TargetReadinessRow[];
  targetSummary: TargetSummary;
  mappings: { drafted: number; enabled: number; unmapped: number; rows: { source: string; target: string | null; confidence: string; fieldCount: number; enabled: boolean }[] };
  warnings: Warning[];
};

export default function AnalysisPage() {
  const params = useParams();
  const id = String(params.id);
  const { user, loading, logout } = useSession();
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [targetFilter, setTargetFilter] = useState("");
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);

  useEffect(() => {
    if (!user) return;
    apiGet<AnalysisReport>(`/projects/${id}/analysis`)
      .then(setReport)
      .catch((e) => setErr((e as Error).message));
  }, [user, id]);

  if (loading) return <main className="container"><p className="muted">Loading…</p></main>;
  if (!user) return null;
  if (err)
    return (
      <>
        <AppHeader user={user} onLogout={() => void logout()} />
        <main className="container fade-in">
          <Link href={`/projects/${id}`}>← Back to project</Link>
          <div className="banner banner-danger" style={{ marginTop: 16 }}>{err}</div>
          <p className="muted" style={{ marginTop: 12 }}>Run Analyze (with the source org connected) to generate the report.</p>
        </main>
      </>
    );
  if (!report) return <main className="container"><p className="muted">Loading analysis…</p></main>;

  const q = filter.trim().toLowerCase();
  const objects = report.source.objects.filter((o) => !q || o.name.toLowerCase().includes(q) || o.label.toLowerCase().includes(q));
  const cfg = report.source.config;

  const tq = targetFilter.trim().toLowerCase();
  const targetRows = report.targetReadiness.filter((t) => {
    if (needsAttentionOnly && t.outcome !== "WARN" && t.outcome !== "MISSING") return false;
    if (!tq) return true;
    return (
      t.object.toLowerCase().includes(tq) ||
      t.label.toLowerCase().includes(tq) ||
      t.mappedBy.some((m) => m.source.toLowerCase().includes(tq))
    );
  });

  return (
    <>
      <AppHeader user={user} onLogout={() => void logout()} />
      <main className="container fade-in">
      <Link href={`/projects/${id}`}>← Back to project</Link>
      <h1 style={{ margin: "10px 0 4px" }}>NPSP Analysis Report</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {report.meta.projectName}
        {report.meta.analyzedAt ? ` · analyzed ${new Date(report.meta.analyzedAt).toLocaleString()}` : " · not yet analyzed"}
        {report.meta.source?.apiVersion ? ` · API v${report.meta.source.apiVersion}` : ""}
        {" · "}
        <Link href="/guide#analyze">How to read this report →</Link>
      </p>

      {/* Overview */}
      <section className="card">
        <div className="spread" style={{ alignItems: "flex-start" }}>
          <div className="stat-row">
            <Stat label="Objects" value={`${report.source.objectCount}`} sub={`${report.source.objectsWithData} with data`} />
            <Stat label="Total records" value={report.source.totalRecords.toLocaleString()} />
            <Stat label="Mappings" value={`${report.mappings.enabled}/${report.mappings.drafted}`} sub={`${report.mappings.unmapped} unmapped`} />
            <Stat label="Warnings" value={`${report.warnings.length}`} />
          </div>
          <div className="toolbar">
            <button className="btn" onClick={() => void downloadFile(`/projects/${id}/analysis?format=md`, `npsp-analysis-${id}.md`)}>↓ Markdown</button>
            <button className="btn btn-secondary" onClick={() => void downloadFile(`/projects/${id}/analysis?format=json`, `npsp-analysis-${id}.json`)}>↓ JSON</button>
          </div>
        </div>
        {report.meta.capability && (
          <div className="toolbar" style={{ marginTop: 14, gap: 8 }}>
            <CapFlag on={report.meta.capability.npspInstalled} label="NPSP installed" />
            <CapFlag on={report.meta.capability.enhancedRecurringDonations} label="Enhanced RD" />
            <CapFlag on={report.meta.capability.personAccountsEnabled} label="Person Accounts" />
          </div>
        )}
      </section>

      {/* Warnings */}
      <Section title={`Warnings (${report.warnings.length})`}>
        {report.warnings.length === 0 ? (
          <div className="empty">No warnings — the source org looks clean for migration.</div>
        ) : (
          <div className="stack" style={{ gap: 0 }}>
            {report.warnings.map((w, i) => (
              <WarningRow key={i} warning={w} first={i === 0} />
            ))}
          </div>
        )}
      </Section>

      {/* Source inventory + field dictionary */}
      <Section title={`Source Object Inventory (${report.source.objectCount})`}>
        <input className="input" placeholder="Filter objects…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: 10 }} />
        <div className="table-wrap scroll-y">
          <table className="data">
            <thead>
              <tr>
                <th>Object</th>
                <th>Type</th>
                <th className="num">Records</th>
                <th className="num">Fields</th>
                <th className="num">Rec. Types</th>
                <th className="shrink" />
              </tr>
            </thead>
            <tbody>
              {objects.map((o) => (
                <Fragment key={o.name}>
                  <tr>
                    <td><code>{o.name}</code><div className="sub">{o.label}</div></td>
                    <td>{o.custom ? <span className="pill pill-info">custom</span> : <span className="pill pill-neutral">standard</span>}</td>
                    <td className="num">{o.count.toLocaleString()}</td>
                    <td className="num">{o.fields.length}</td>
                    <td className="num">{o.recordTypes.length}</td>
                    <td className="shrink">
                      <button className="btn btn-secondary btn-sm" onClick={() => setExpanded(expanded === o.name ? null : o.name)}>
                        {expanded === o.name ? "Hide" : "Fields"}
                      </button>
                    </td>
                  </tr>
                  {expanded === o.name && (
                    <tr>
                      <td colSpan={6} style={{ background: "var(--surface-2)" }}>
                        <FieldDictionary object={o} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {objects.length === 0 && (
                <tr><td colSpan={6}><div className="empty">No objects match “{filter}”.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Validation rules & automations */}
      <Section title="Validation Rules & Automations">
        {!cfg ? (
          <div className="empty">No configuration audit was captured for this run.</div>
        ) : (
          <div className="stack" style={{ gap: 18 }}>
            <DataTable title={`Validation Rules (${cfg.validationRules.length})`} headers={["Object", "Rule", "Active"]}
              rows={cfg.validationRules.map((v) => [<code key="o">{v.object}</code>, v.name, <ActivePill key="a" on={v.active} />])} />
            <DataTable title={`Flows (${cfg.flows.length})`} headers={["API Name", "Label", "Trigger Object"]}
              rows={cfg.flows.map((f) => [<code key="o">{f.apiName}</code>, f.label, f.triggerObject ?? "—"])} />
            <DataTable title={`Apex Triggers (${cfg.apexTriggers.length})`} headers={["Name", "Object", "Events"]}
              rows={cfg.apexTriggers.map((t) => [<code key="o">{t.name}</code>, t.object, t.events.join(", ")])} />
            <DataTable title={`NPSP TDTM Handlers (${cfg.tdtmHandlers.length})`} headers={["Class", "Object", "Trigger", "Active"]}
              rows={cfg.tdtmHandlers.map((t) => [<code key="o">{t.className}</code>, t.object, t.trigger, <ActivePill key="a" on={t.active} />])} />
            <div className="toolbar" style={{ gap: 20 }}>
              <SmallCount label="Workflow Rules" n={cfg.workflowRules.length} />
              <SmallCount label="Duplicate Rules" n={cfg.duplicateRules.length} />
            </div>
            {cfg.skipped.length > 0 && (
              <p className="muted">Not captured: {cfg.skipped.map((s) => `${s.kind} (${s.reason})`).join("; ")}</p>
            )}
          </div>
        )}
      </Section>

      {/* NPSP configuration */}
      <Section title="NPSP Configuration">
        {!cfg || Object.keys(cfg.npspSettings).length === 0 ? (
          <div className="empty">No NPSP custom settings captured.</div>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            {Object.entries(cfg.npspSettings).map(([obj, rows]) => (
              <div key={obj} style={{ fontSize: 13 }}><code>{obj}</code> <span className="muted">— {rows.length} row(s)</span></div>
            ))}
          </div>
        )}
      </Section>

      {/* Target readiness */}
      <Section title={`Target Org Readiness (${report.targetSummary.total})`}>
        {report.targetReadiness.length === 0 ? (
          <div className="empty">Connect the target NPC org and re-run Analyze to check readiness.</div>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              {report.targetSummary.mapped} mapped ({report.targetSummary.unmapped} unused) ·{" "}
              <span style={{ color: report.targetSummary.issuesEnabled > 0 ? "var(--danger-fg)" : "inherit" }}>
                {report.targetSummary.issuesEnabled} issue(s) in enabled mappings
              </span>
              , {report.targetSummary.issuesUnreviewed} in unreviewed drafts
            </p>
            <div className="toolbar" style={{ marginBottom: 10 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="Filter target objects…"
                value={targetFilter}
                onChange={(e) => setTargetFilter(e.target.value)}
              />
              <label className="check">
                <input type="checkbox" checked={needsAttentionOnly} onChange={(e) => setNeedsAttentionOnly(e.target.checked)} />
                needs attention only
              </label>
            </div>
            <div className="table-wrap scroll-y">
              <table className="data">
                <thead>
                  <tr>
                    <th>Target Object</th>
                    <th>Mapped From</th>
                    <th>Outcome</th>
                    <th className="num">Records</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {targetRows.map((t) => (
                    <tr key={t.object}>
                      <td>
                        <code>{t.object}</code>
                        {t.label && t.label !== t.object && <div className="sub">{t.label}</div>}
                      </td>
                      <td>
                        {t.mappedBy.length ? (
                          t.mappedBy.map((m) => (
                            <div key={m.source}>
                              <code>{m.source}</code>
                              {!m.enabled && <span className="pill pill-neutral" style={{ marginLeft: 4 }}>disabled</span>}
                            </div>
                          ))
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td><OutcomePill outcome={t.outcome} /></td>
                      <td className="num">{t.count.toLocaleString()}</td>
                      <td className="muted">
                        {!t.exists
                          ? `missing — ${t.suggestions.join(", ") || "no suggestions"}`
                          : t.missingFields.length
                            ? `missing: ${t.missingFields.join(", ")}`
                            : "—"}
                      </td>
                    </tr>
                  ))}
                  {targetRows.length === 0 && (
                    <tr><td colSpan={5}><div className="empty">No target objects match.</div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      {/* Mapping summary */}
      <Section title="Mapping Summary">
        <p className="muted" style={{ marginTop: 0 }}>
          Review &amp; edit in the <Link href={`/projects/${id}/mappings`}>Mapping Editor →</Link> · new to
          NPSP/NPC differences? <Link href="/guide#npsp-vs-npc">See the translation guide →</Link>
        </p>
        <DataTable
          headers={["Source", "→ Target", "Confidence", "Fields", "Enabled"]}
          aligns={["", "", "", "num", ""]}
          rows={report.mappings.rows.map((m) => [
            <code key="s">{m.source}</code>,
            m.target ? <code key="t">{m.target}</code> : <span key="t" className="faint">—</span>,
            <ConfidencePill key="c" confidence={m.confidence} />,
            String(m.fieldCount),
            m.enabled ? <span key="e" className="pill pill-success">on</span> : <span key="e" className="pill pill-neutral">off</span>,
          ])}
        />
      </Section>
      </main>
    </>
  );
}

function WarningRow({ warning: w, first }: { warning: Warning; first: boolean }) {
  const [open, setOpen] = useState(false);
  const hint = w.object ? findTranslation(w.object) : undefined;
  return (
    <div style={{ padding: "8px 0", borderTop: first ? undefined : "1px solid var(--border-soft)" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
        <SeverityPill severity={w.severity} />
        <span style={{ fontSize: 13 }}>{w.message}</span>
      </div>
      {hint && (
        <div style={{ marginLeft: 2 }}>
          <TranslationHint item={hint} />
        </div>
      )}
      {(w.why || w.action) && (
        <div className="disclosure">
          <button className="disclosure-toggle" onClick={() => setOpen(!open)}>
            {open ? "Hide details" : "Why? / What to do?"}
          </button>
          {open && (
            <div className="disclosure-body">
              {w.why && <div><strong>Why:</strong> {w.why}</div>}
              {w.action && <div><strong>What to do:</strong> {w.action}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldDictionary({ object }: { object: ReportObject }) {
  return (
    <div style={{ padding: "4px 0" }}>
      {object.lookups.length > 0 && (
        <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>
          <strong style={{ color: "var(--text)" }}>Lookups:</strong>{" "}
          {object.lookups.map((l) => `${l.field} → ${l.referenceTo.join("/")}`).join("  ·  ")}
        </div>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Field</th><th>Type</th><th>Req</th><th>Unique</th><th>Formula</th><th>Picklist / Ref</th>
            </tr>
          </thead>
          <tbody>
            {object.fields.map((f) => (
              <tr key={f.name}>
                <td><code>{f.name}</code></td>
                <td className="muted">{f.type}</td>
                <td>{f.required ? <span className="pill pill-warn">req</span> : ""}</td>
                <td>{f.unique ? "✓" : ""}</td>
                <td>{f.calculated ? "ƒ" : ""}</td>
                <td className="muted">
                  {f.picklistValues?.length
                    ? f.picklistValues.slice(0, 6).map((p) => p.value).join("; ") + (f.picklistValues.length > 6 ? " …" : "")
                    : f.referenceTo?.length
                      ? `→ ${f.referenceTo.join(", ")}`
                      : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 style={{ marginTop: 0, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}{sub ? ` · ${sub}` : ""}</div>
    </div>
  );
}
function DataTable({ title, headers, rows, aligns }: { title?: string; headers: string[]; rows: React.ReactNode[][]; aligns?: string[] }) {
  return (
    <div>
      {title && <div style={{ fontSize: 13, color: "#c7cff0", marginBottom: 6, fontWeight: 600 }}>{title}</div>}
      <div className="table-wrap">
        <table className="data">
          <thead><tr>{headers.map((h, i) => <th key={h} className={aligns?.[i] === "num" ? "num" : undefined}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={headers.length}><div className="empty">none</div></td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j} className={aligns?.[j] === "num" ? "num" : undefined}>{c}</td>)}</tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function SmallCount({ label, n }: { label: string; n: number }) {
  return <div style={{ fontSize: 13 }}><strong>{n}</strong> <span className="muted">{label}</span></div>;
}
function ActivePill({ on }: { on: boolean }) {
  return on ? <span className="pill pill-success">active</span> : <span className="pill pill-neutral">off</span>;
}
