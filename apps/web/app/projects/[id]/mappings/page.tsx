"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPatch, card, btn, input } from "../../../lib/api";
import { useSession } from "../../../lib/useSession";

type Mapping = {
  id: string;
  object: string; // source object
  target: string | null;
  fieldMap: Record<string, string>;
  enabled: boolean;
  confidence: string | null;
  autoDrafted: boolean;
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
  const { user, loading: sessionLoading } = useSession();

  const [mappings, setMappings] = useState<Mapping[] | null>(null);
  const [projectName, setProjectName] = useState("");
  const [filter, setFilter] = useState("");
  const [onlyEnabled, setOnlyEnabled] = useState(false);
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

  if (sessionLoading) return <main style={wrap}>Loading…</main>;
  if (!user) return null;
  if (!mappings) return <main style={wrap}>{err ? <p style={errStyle}>{err}</p> : "Loading mappings…"}</main>;

  const q = filter.trim().toLowerCase();
  const rows = mappings.filter((m) => {
    if (onlyEnabled && !m.enabled) return false;
    if (!q) return true;
    return m.object.toLowerCase().includes(q) || (m.target ?? "").toLowerCase().includes(q);
  });
  const enabledCount = mappings.filter((m) => m.enabled).length;

  return (
    <main style={wrap}>
      <Link href={`/projects/${id}`} style={{ color: "#93c5fd" }}>
        ← Back to project
      </Link>
      <h1 style={{ marginBottom: 4 }}>Mapping Editor — {projectName}</h1>
      <p style={{ color: "#9aa4c0", marginTop: 0 }}>
        {mappings.length} mappings drafted · {enabledCount} enabled. Enabled mappings run in
        Transform/Load; heuristic drafts start disabled — review a target &amp; fields, then enable.
      </p>
      {err && <p style={errStyle}>{err}</p>}

      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "12px 0" }}>
        <input
          style={{ ...input, flex: 1 }}
          placeholder="Filter by source or target object…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label style={{ color: "#9aa4c0", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={onlyEnabled}
            onChange={(e) => setOnlyEnabled(e.target.checked)}
          />{" "}
          enabled only
        </label>
      </div>

      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "#9aa4c0", textAlign: "left" }}>
              <th style={th}>Source object</th>
              <th style={th}>→ Target object</th>
              <th style={th}>Confidence</th>
              <th style={{ ...th, textAlign: "right" }}>Fields</th>
              <th style={{ ...th, textAlign: "center" }}>Enabled</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} style={{ borderTop: "1px solid #283157" }}>
                <td style={td}>
                  <code>{m.object}</code>
                </td>
                <td style={td}>
                  {m.target ? <code>{m.target}</code> : <span style={{ color: "#fca5a5" }}>— unmapped —</span>}
                </td>
                <td style={td}>
                  <ConfidencePill confidence={m.confidence} />
                </td>
                <td style={{ ...td, textAlign: "right", color: "#9aa4c0" }}>
                  {Object.keys(m.fieldMap ?? {}).length}
                </td>
                <td style={{ ...td, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={m.enabled}
                    disabled={!m.target}
                    title={!m.target ? "Set a target object first" : ""}
                    onChange={() => void toggleEnabled(m)}
                  />
                </td>
                <td style={{ ...td, textAlign: "right" }}>
                  <button
                    style={{ ...btn, background: "#334155", padding: "2px 10px" }}
                    onClick={() => setEditingId(editingId === m.id ? null : m.id)}
                  >
                    {editingId === m.id ? "Close" : "Edit"}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td style={{ ...td, color: "#9aa4c0" }} colSpan={6}>
                  No mappings match. Run Analyze (with both orgs connected) to draft mappings.
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
    <section style={{ ...card, borderColor: "#3b82f6" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>
          Editing <code>{mapping.object}</code>
        </strong>
        <button style={{ ...btn, background: "#334155", padding: "2px 10px" }} onClick={onClose}>
          Close
        </button>
      </div>
      {err && <p style={errStyle}>{err}</p>}
      {note && <p style={{ color: "#86efac", fontSize: 13 }}>{note}</p>}
      {!schema && <p style={{ color: "#9aa4c0" }}>Loading schema…</p>}

      {schema && (
        <>
          {/* 1. Target object */}
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13, color: "#9aa4c0", marginBottom: 4 }}>
              1. Target NPC object ({schema.targetObjects.length} available)
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                style={{ ...input, flex: 1 }}
                list="target-objects"
                placeholder="Type to search target objects…"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
              />
              <datalist id="target-objects">
                {schema.targetObjects.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.label}
                  </option>
                ))}
              </datalist>
              <button style={btn} onClick={() => void setTarget()} disabled={busy}>
                Set target
              </button>
            </div>
          </div>

          {/* 2. Field map */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, color: "#9aa4c0", marginBottom: 4 }}>
              2. Field mapping{" "}
              {mapping.target ? (
                <>
                  (<code>{mapping.object}</code> → <code>{mapping.target}</code>)
                </>
              ) : (
                <span style={{ color: "#fca5a5" }}>— set a target object first —</span>
              )}
            </div>

            {targetSet && (
              <>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "#9aa4c0", textAlign: "left" }}>
                      <th style={th}>Source field</th>
                      <th style={th}>→ Target field</th>
                      <th style={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #283157" }}>
                        <td style={td}>
                          <select
                            style={{ ...input, width: "100%" }}
                            value={r.source}
                            onChange={(e) =>
                              setRows(rows.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)))
                            }
                          >
                            <option value="">—</option>
                            {sourceFields.map((f) => (
                              <option key={f.name} value={f.name}>
                                {f.name} ({f.type})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={td}>
                          <select
                            style={{ ...input, width: "100%" }}
                            value={r.target}
                            onChange={(e) =>
                              setRows(rows.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))
                            }
                          >
                            <option value="">—</option>
                            {targetFields.map((f) => (
                              <option key={f.name} value={f.name}>
                                {f.name} ({f.type})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          <button
                            style={{ ...btn, background: "#3f1d1d", color: "#fca5a5", padding: "2px 8px" }}
                            onClick={() => setRows(rows.filter((_, j) => j !== i))}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    style={{ ...btn, background: "#334155" }}
                    onClick={() => setRows([...rows, { source: "", target: "" }])}
                  >
                    + Add field
                  </button>
                  <button style={btn} onClick={() => void saveFieldMap()} disabled={busy}>
                    {busy ? "Saving…" : "Save field map"}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ConfidencePill({ confidence }: { confidence: string | null }) {
  const colors: Record<string, [string, string]> = {
    curated: ["#14532d", "#86efac"],
    heuristic: ["#1e3a5f", "#93c5fd"],
    unmapped: ["#3f1d1d", "#fca5a5"],
  };
  const [bg, fg] = colors[confidence ?? "unmapped"] ?? colors.unmapped!;
  return (
    <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 8px", fontSize: 12 }}>
      {confidence ?? "manual"}
    </span>
  );
}

const wrap: React.CSSProperties = { maxWidth: 900, margin: "0 auto", padding: "48px 24px" };
const th: React.CSSProperties = { padding: "6px 8px" };
const td: React.CSSProperties = { padding: "6px 8px" };
const errStyle: React.CSSProperties = { color: "#f87171" };
