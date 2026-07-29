"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiPost } from "../lib/api";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await apiPost("/auth/signup", { name, email, password });
      router.push("/");
    } catch (e) {
      setErr((e as Error).message || "Sign up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <h1>Create your account</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Each account owns its own migration projects and org connections.
      </p>
      <form onSubmit={submit} className="card stack">
        <label className="field">
          Name (optional)
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Email
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field" style={{ marginBottom: 0 }}>
          Password (min. 8 characters)
          <input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <div className="banner banner-danger">{err}</div>}
        <button type="submit" className="btn" style={{ justifyContent: "center" }} disabled={busy}>
          {busy ? "Creating account…" : "Sign up"}
        </button>
      </form>
      <p className="muted" style={{ marginTop: 14 }}>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
