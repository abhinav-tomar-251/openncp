"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiPost, card, btn, input } from "../lib/api";

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
    <main style={wrap}>
      <h1>OpenNPC Migration Platform</h1>
      <p style={{ color: "#9aa4c0", marginTop: 0 }}>Log in to your migration projects.</p>
      <form onSubmit={submit} style={card}>
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
          Password
          <input
            style={{ ...input, width: "100%", marginTop: 4 }}
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {err && <p style={{ color: "#f87171" }}>{err}</p>}
        <button type="submit" style={{ ...btn, marginTop: 8 }} disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p style={{ color: "#9aa4c0" }}>
        No account?{" "}
        <Link href="/signup" style={{ color: "#93c5fd" }}>
          Sign up
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
