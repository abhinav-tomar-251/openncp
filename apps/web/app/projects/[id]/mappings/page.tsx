"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPatch } from "../../../lib/api";
import { useSession } from "../../../lib/useSession";
import { AppHeader } from "../../../components/AppHeader";
import { ConfidencePill, OutcomePill } from "../../../components/pills";
import { BookIcon } from "../../../components/icons";

type Mapping = {
  id: string;
  object: string; // source object
  target: string | null;
  fieldMap: Record<string, string>;
  enabled: boolean;
  confidence: string | null;
  autoDrafted: boolean;
  /** Target-schema readiness from the latest Analyze run — PASS/WARN/MISSING/UNMAPPED/null. */
  targetOutcome: string | null;
};
type FieldMeta = { name: string; label: string; type: string };
type MappingSchema = {
  source: { object: string; fields: FieldMeta[] };
  target: { object: string; fields: FieldMeta[] } | null;
  targetObjects: { name: string; label: string }[];
};
type FieldRow = { source: string; target: string };

export default function MappingsPage() {
  const params = useParams();
  const id = String(params.id);
  const { user, loading: sessionLoading, logout } = useSession();

  const [mappings, setMappings] = useState<Mapping[] | null>(null);
  const [projectName, setProjectName] = useState("");
  const [filter, setFilter] = useState("");
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function loadList() {
    try {
      const [project, list] = await Promise.all([
        apiGet<{ name: string }>(`/projects/${id}`),
        apiGet<Mapping[]>(`/projects/${id}/mappings`),
      ]);
      setProjectName(project.name);
      setMappings(list);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    if (user) void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function toggleEnabled(m: Mapping) {
    setErr("");
    try {
      await apiPatch(`/projects/${id}/mappings/${m.id}`, { enabled: !m.enabled });
      await loadList();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (sessionLoading) return <main className="container"><p className="muted">Loading…</p></main>;
  if (!user) return null;
  if (!mappings)
    return (
      <>
        <AppHeader user={user} onLogout={() => void logout()} />
        <main className="container fade-in">
          {err ? <div className="banner banner-danger">{err}</div> : <p className="muted">Loading mappings…</p>}
        </main>
      </>
    );

  const q = filter.trim().toLowerCase();
  const rows = mappings.filter((m) => {
    if (onlyEnabled && !m.enabled) return false;
    if (needsAttentionOnly && m.targetOutcome !== "WARN" && m.targetOutcome !== "MISSING") return false;
    if (!q) return true;
    return m.object.toLowerCase().includes(q) || (m.target ?? "").toLowerCase().includes(q);
  });
  const enabledCount = mappings.filter((m) => m.enabled).length;
  const needsAttentionCount = mappings.filter((m) => m.targetOutcome === "WARN" || m.targetOutcome === "MISSING").length;

  return (
    <>
      <AppHeader user={user} onLogout={() => void logout()} />
      <main className="container fade-in">
      <Link href={`/projects/${id}`}>← Back to project</Link>
      <h1 style={{ margin: "10px 0 4px" }}>Mapping Editor</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {projectName} · {mappings.length} mappings drafted · {enabledCount} enabled. Enabled mappings run
        in Transform/Load; heuristic drafts start disabled — review a target &amp; fields, then enable.
      </p>
      {err && <div className="banner banner-danger" style={{ margin: "12px 0" }}>{err}</div>}

      <Link href="/guide#mapping" className="callout" style={{ textDecoration: "none", margin: "10px 0" }}>
        <BookIcon size={16} />
        <span>
          Unsure what a heuristic guess means, or why Payments/Recurring Donations/Allocations need
          special review? See the Guide&apos;s <strong>Review the Mapping</strong> section.
        </span>
      </Link>

      <div className="toolbar" style={{ margin: "14px 0" }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Filter by source or target object…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="check">
          <input type="checkbox" checked={onlyEnabled} onChange={(e) => setOnlyEnabled(e.target.checked)} />
          enabled only
        </label>
        <label className="check">
          <input type="checkbox" checked={needsAttentionOnly} onChange={(e) => setNeedsAttentionOnly(e.target.checked)} />
          needs attention only ({needsAttentionCount})
        </label>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Source object</th>
              <th>→ Target object</th>
              <th>Confidence</th>
              <th className="num">Fields</th>
              <th style={{ textAlign: "center" }}>Enabled</th>
              <th className="shrink" />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td><code>{m.object}</code></td>
                <td>{m.target ? <code>{m.target}</code> : <span className="pill pill-danger">unmapped</span>}</td>
                <td>
                  <ConfidencePill confidence={m.confidence} />
                  {(m.targetOutcome === "WARN" || m.targetOutcome === "MISSING") && (
                    <span style={{ marginLeft: 6 }}>
                      <OutcomePill outcome={m.targetOutcome} />
                    </span>
                  )}
                </td>
                <td className="num">{Object.keys(m.fieldMap ?? {}).length}</td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={m.enabled}
                    disabled={!m.target}
                    title={!m.target ? "Set a target object first" : ""}
                    onChange={() => void toggleEnabled(m)}
                  />
                </td>
                <td className="shrink">
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(editingId === m.id ? null : m.id)}>
                    {editingId === m.id ? "Close" : "Edit"}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty">No mappings match. Run Analyze (with both orgs connected) to draft mappings.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingId && (
        <MappingEditor
          projectId={id}
          mapping={mappings.find((m) => m.id === editingId)!}
          onSaved={loadList}
          onClose={() => setEditingId(null)}
        />
      )}
      </main>
    </>
  );
}

function MappingEditor({
  projectId,
  mapping,
  onSaved,
  onClose,
}: {
  projectId: string;
  mapping: Mapping;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [schema, setSchema] = useState<MappingSchema | null>(null);
  const [targetInput, setTargetInput] = useState(mapping.target ?? "");
  const [rows, setRows] = useState<FieldRow[]>(
    Object.entries(mapping.fieldMap ?? {}).map(([source, target]) => ({ source, target })),
  );
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  async function loadSchema() {
    setErr("");
    try {
      setSchema(await apiGet<MappingSchema>(`/projects/${projectId}/mappings/${mapping.id}/schema`));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    void loadSchema();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping.id]);

  async function setTarget() {
    setBusy(true);
    setNote("");
    setErr("");
    try {
      await apiPatch(`/projects/${projectId}/mappings/${mapping.id}`, { target: targetInput || null });
      await loadSchema(); // reload so the target's real fields become available
      await onSaved();
      setNote("Target updated. Now map fields below.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveFieldMap() {
    setBusy(true);
    setNote("");
    setErr("");
    try {
      const fieldMap: Record<string, string> = {};
      for (const r of rows) if (r.source && r.target) fieldMap[r.source] = r.target;
      await apiPatch(`/projects/${projectId}/mappings/${mapping.id}`, { fieldMap });
      await onSaved();
      setNote(`Saved ${Object.keys(fieldMap).length} field mappings.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sourceFields = schema?.source.fields ?? [];
  const targetFields = schema?.target?.fields ?? [];
  const targetSet = !!mapping.target;

  return (
    <section className="card card-accent">
      <div className="card-hd">
        <strong>Editing <code>{mapping.object}</code></strong>
        <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
      </div>
      {err && <div className="banner banner-danger" style={{ marginTop: 8 }}>{err}</div>}
      {note && <div className="banner banner-success" style={{ marginTop: 8 }}>{note}</div>}
      {!schema && <p className="muted">Loading schema…</p>}

      {schema && (
        <>
          {/* 1. Target object */}
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ marginBottom: 6, fontWeight: 600, color: "#c7cff0" }}>
              1 · Target NPC object <span className="faint">({schema.targetObjects.length} available)</span>
            </div>
            <div className="toolbar">
              <input
                className="input"
                style={{ flex: 1 }}
                list="target-objects"
                placeholder="Type to search target objects…"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
              />
              <datalist id="target-objects">
                {schema.targetObjects.map((t) => (
                  <option key={t.name} value={t.name}>{t.label}</option>
                ))}
              </datalist>
              <button className="btn" onClick={() => void setTarget()} disabled={busy}>Set target</button>
            </div>
          </div>

          {/* 2. Field map */}
          <div style={{ marginTop: 18 }}>
            <div className="muted" style={{ marginBottom: 6, fontWeight: 600, color: "#c7cff0" }}>
              2 · Field mapping{" "}
              {mapping.target ? (
                <span className="faint">(<code>{mapping.object}</code> → <code>{mapping.target}</code>)</span>
              ) : (
                <span className="pill pill-danger" style={{ marginLeft: 4 }}>set a target object first</span>
              )}
            </div>

            {targetSet && (
              <>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Source field</th>
                        <th>→ Target field</th>
                        <th className="shrink" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          <td>
                            <select className="input" value={r.source}
                              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)))}>
                              <option value="">—</option>
                              {sourceFields.map((f) => <option key={f.name} value={f.name}>{f.name} ({f.type})</option>)}
                            </select>
                          </td>
                          <td>
                            <select className="input" value={r.target}
                              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))}>
                              <option value="">—</option>
                              {targetFields.map((f) => <option key={f.name} value={f.name}>{f.name} ({f.type})</option>)}
                            </select>
                          </td>
                          <td className="shrink">
                            <button className="btn btn-danger btn-sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
                          </td>
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr><td colSpan={3}><div className="empty">No field mappings yet — add one below.</div></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <button className="btn btn-secondary" onClick={() => setRows([...rows, { source: "", target: "" }])}>+ Add field</button>
                  <button className="btn" onClick={() => void saveFieldMap()} disabled={busy}>{busy ? "Saving…" : "Save field map"}</button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
