"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_BASE, apiGet, apiPost } from "./lib/api";
import { useSession } from "./lib/useSession";
import { AppHeader } from "./components/AppHeader";
import { BookIcon } from "./components/icons";

type Project = {
  id: string;
  name: string;
  createdAt: string;
  connections: { role: string }[];
};

const STAGES = [
  { n: 1, name: "Analyze", desc: "Connect orgs, discover schema, draft mapping" },
  { n: 2, name: "Extract", desc: "Bulk API 2.0 query into staging" },
  { n: 3, name: "Transform", desc: "Map NPSP → NPC, build id_xref, prep target" },
  { n: 4, name: "Load", desc: "Idempotent upsert into NPC" },
  { n: 5, name: "Validate", desc: "Reconcile counts & totals, report" },
];

export default function Home() {
  const { user, loading: sessionLoading, logout } = useSession();
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    try {
      await apiGet("/health");
      setApiOk(true);
      setProjects(await apiGet<Project[]>("/projects"));
    } catch {
      setApiOk(false);
    }
  }

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

  if (sessionLoading) return <main className="container container-narrow"><p className="muted">Loading…</p></main>;
  if (!user) return null; // redirecting to /login

  return (
    <>
      <AppHeader user={user} onLogout={() => void logout()} />
      <main className="container container-narrow fade-in">
        <h1 style={{ margin: "10px 0 4px" }}>OpenNPC Migration Platform</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Migrate Salesforce NPSP → Nonprofit Cloud. API{" "}
          <span className={`pill ${apiOk == null ? "pill-neutral" : apiOk ? "pill-success" : "pill-danger"}`}>
            {apiOk == null ? "checking…" : apiOk ? "online" : "unreachable"}
          </span>{" "}
          <span className="faint">{API_BASE}</span>
        </p>

        <Link href="/guide" className="callout" style={{ textDecoration: "none", marginBottom: 4 }}>
          <BookIcon size={18} />
          <span>
            <strong>New here?</strong> Read the Migration Guide — a plain-language, step-by-step
            walkthrough of moving an NPSP org into a fresh NPC org.
          </span>
        </Link>

        <h2 style={{ marginTop: 30 }}>Migration projects</h2>
      <form onSubmit={createProject} className="card toolbar">
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="New project name (e.g. Acme Foundation)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Creating…" : "Create project"}
        </button>
      </form>
      {err && <div className="banner banner-danger">{err}</div>}

      {projects.length === 0 ? (
        <div className="card"><div className="empty">No projects yet — create one to connect your orgs.</div></div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {projects.map((p) => (
            <li key={p.id} className="card">
              <div className="spread">
                <Link href={`/projects/${p.id}`} style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</Link>
                <div className="toolbar" style={{ gap: 6 }}>
                  {p.connections.length === 0 ? (
                    <span className="pill pill-neutral">no orgs connected</span>
                  ) : (
                    p.connections.map((c) => <span key={c.role} className="pill pill-info">{c.role}</span>)
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: 34 }}>The 5-stage migration</h2>
      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {STAGES.map((s) => (
          <li key={s.n} className="card" style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <span
              style={{
                flex: "0 0 auto",
                width: 30,
                height: 30,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                background: "var(--accent-soft)",
                color: "#9cc4ff",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {s.n}
            </span>
            <div>
              <strong>{s.name}</strong>
              <div className="muted">{s.desc}</div>
            </div>
          </li>
        ))}
      </ol>
      </main>
    </>
  );
}
