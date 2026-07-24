"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_BASE, apiGet, apiPost, card, btn, input } from "./lib/api";
import { useSession } from "./lib/useSession";

type Project = {
  id: string;
  name: string;
  createdAt: string;
  connections: { role: string }[];
};

const STAGES = [
  { n: 1, name: "Analyze", desc: "Connect orgs, discover schema, draft mapping" },
  { n: 2, name: "Extract", desc: "Bulk API 2.0 query into staging" },
  { n: 3, name: "Transform", desc: "Map NPSP -> NPC, build id_xref, prep target" },
  { n: 4, name: "Load", desc: "Idempotent upsert into NPC" },
  { n: 5, name: "Validate", desc: "Reconcile counts & totals, report" },
];

export default function Home() {
  const { user, loading: sessionLoading, logout } = useSession();
  const [apiStatus, setApiStatus] = useState("checking…");
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    try {
      await apiGet("/health");
      setApiStatus("ok ✓");
      setProjects(await apiGet<Project[]>("/projects"));
    } catch {
      setApiStatus("unreachable ✗");
    }
  }

  // Only load the (auth-scoped) project list once we know who's signed in.
  useEffect(() => {
    if (user) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await apiPost<Project>("/projects", { name: name.trim() });
      setName("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sessionLoading) return <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>Loading…</main>;
  if (!user) return null; // redirecting to /login

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ marginBottom: 4 }}>OpenNPC Migration Platform</h1>
        <div style={{ fontSize: 13, color: "#9aa4c0" }}>
          {user.email} ·{" "}
          <button
            onClick={() => void logout()}
            style={{ background: "none", border: "none", color: "#93c5fd", cursor: "pointer", padding: 0 }}
          >
            Log out
          </button>
        </div>
      </div>
      <p style={{ color: "#9aa4c0", marginTop: 0 }}>
        Migrate Salesforce NPSP → Nonprofit Cloud. API: <strong>{apiStatus}</strong> ({API_BASE})
      </p>

      <h2 style={{ marginTop: 28 }}>Migration projects</h2>
      <form onSubmit={createProject} style={{ ...card, display: "flex", gap: 8 }}>
        <input
          style={{ ...input, flex: 1 }}
          placeholder="New project name (e.g. Acme Foundation)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" style={btn} disabled={busy}>
          {busy ? "Creating…" : "Create project"}
        </button>
      </form>
      {err && <p style={{ color: "#f87171" }}>{err}</p>}

      {projects.length === 0 ? (
        <p style={{ color: "#9aa4c0" }}>No projects yet — create one to connect your orgs.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {projects.map((p) => (
            <li key={p.id} style={card}>
              <Link href={`/projects/${p.id}`} style={{ color: "#93c5fd", fontWeight: 600 }}>
                {p.name}
              </Link>
              <div style={{ color: "#9aa4c0", fontSize: 13, marginTop: 4 }}>
                Connected: {p.connections.length ? p.connections.map((c) => c.role).join(", ") : "none"}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: 32 }}>The 5-stage migration</h2>
      <ol style={{ listStyle: "none", padding: 0 }}>
        {STAGES.map((s) => (
          <li key={s.n} style={card}>
            <strong>
              {s.n}. {s.name}
            </strong>
            <div style={{ color: "#9aa4c0" }}>{s.desc}</div>
          </li>
        ))}
      </ol>
    </main>
  );
}
