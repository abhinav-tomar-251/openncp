"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const STAGES = [
  { n: 1, name: "Analyze", desc: "Connect orgs, discover schema, draft mapping" },
  { n: 2, name: "Extract", desc: "Bulk API 2.0 query into staging" },
  { n: 3, name: "Transform", desc: "Map NPSP -> NPC, build id_xref, prep target" },
  { n: 4, name: "Load", desc: "Idempotent upsert into NPC" },
  { n: 5, name: "Validate", desc: "Reconcile counts & totals, report" },
];

export default function Home() {
  const [apiStatus, setApiStatus] = useState<string>("checking…");
  const [noopResult, setNoopResult] = useState<string>("");

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then((d) => setApiStatus(d.status === "ok" ? "ok ✓" : "degraded"))
      .catch(() => setApiStatus("unreachable ✗"));
  }, []);

  async function enqueueNoop() {
    setNoopResult("enqueuing…");
    try {
      const r = await fetch(`${API_URL}/dev/enqueue-noop`, { method: "POST" });
      const d = await r.json();
      setNoopResult(`enqueued job ${d.jobId} → check worker logs`);
    } catch {
      setNoopResult("failed — is the api running?");
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ marginBottom: 4 }}>OpenNPC Migration Platform</h1>
      <p style={{ color: "#9aa4c0", marginTop: 0 }}>
        Migrate Salesforce NPSP → Nonprofit Cloud. Foundation scaffold (Milestone 1).
      </p>

      <section style={cardStyle}>
        <strong>API health:</strong> {apiStatus}
        <div style={{ marginTop: 12 }}>
          <button onClick={enqueueNoop} style={btnStyle}>
            Enqueue no-op job (smoke test)
          </button>
          {noopResult && <span style={{ marginLeft: 12, color: "#9aa4c0" }}>{noopResult}</span>}
        </div>
      </section>

      <h2 style={{ marginTop: 32 }}>The 5-stage migration</h2>
      <ol style={{ listStyle: "none", padding: 0 }}>
        {STAGES.map((s) => (
          <li key={s.n} style={cardStyle}>
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

const cardStyle: React.CSSProperties = {
  background: "#151b33",
  border: "1px solid #283157",
  borderRadius: 10,
  padding: 16,
  margin: "12px 0",
};

const btnStyle: React.CSSProperties = {
  background: "#3b82f6",
  color: "white",
  border: "none",
  borderRadius: 8,
  padding: "8px 14px",
  cursor: "pointer",
};
