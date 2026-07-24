"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiPost, card, btn, input } from "../lib/api";

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
    <main style={wrap}>
      <h1>Create your account</h1>
      <p style={{ color: "#9aa4c0", marginTop: 0 }}>
        Each account owns its own migration projects and org connections.
      </p>
      <form onSubmit={submit} style={card}>
        <label style={label}>
          Name (optional)
          <input
            style={{ ...input, width: "100%", marginTop: 4 }}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label style={label}>
          Email
          <input
            style={{ ...input, width: "100%", marginTop: 4 }}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label style={label}>
          Password (min. 8 characters)
          <input
            style={{ ...input, width: "100%", marginTop: 4 }}
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {err && <p style={{ color: "#f87171" }}>{err}</p>}
        <button type="submit" style={{ ...btn, marginTop: 8 }} disabled={busy}>
          {busy ? "Creating account…" : "Sign up"}
        </button>
      </form>
      <p style={{ color: "#9aa4c0" }}>
        Already have an account?{" "}
        <Link href="/login" style={{ color: "#93c5fd" }}>
          Log in
        </Link>
      </p>
    </main>
  );
}

const wrap: React.CSSProperties = { maxWidth: 420, margin: "0 auto", padding: "64px 24px" };
const label: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  color: "#9aa4c0",
  marginBottom: 12,
};
