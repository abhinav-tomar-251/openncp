"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiPost } from "../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await apiPost("/auth/login", { email, password });
      router.push("/");
    } catch (e) {
      setErr((e as Error).message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <h1>OpenNPC Migration Platform</h1>
      <p className="muted" style={{ marginTop: 0 }}>Log in to your migration projects.</p>
      <form onSubmit={submit} className="card stack">
        <label className="field">
          Email
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field" style={{ marginBottom: 0 }}>
          Password
          <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <div className="banner banner-danger">{err}</div>}
        <button type="submit" className="btn" style={{ justifyContent: "center" }} disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="muted" style={{ marginTop: 14 }}>
        No account? <Link href="/signup">Sign up</Link>
      </p>
    </main>
  );
}
