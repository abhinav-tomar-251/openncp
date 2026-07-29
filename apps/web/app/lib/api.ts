export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export const isUnauthorized = (e: unknown): boolean => e instanceof ApiError && e.status === 401;

export async function apiGet<T>(path: string): Promise<T> {
  // credentials: "include" sends the session cookie on this cross-origin (api on a
  // different port than web) request — required for the multi-tenant auth cookie.
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, `GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  // Only declare a JSON content-type when we actually send a body — otherwise
  // Fastify rejects the empty body (FST_ERR_CTP_EMPTY_JSON_BODY).
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}) as { error?: string });
    throw new ApiError(res.status, payload.error ?? `POST ${path} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}) as { error?: string });
    throw new ApiError(res.status, payload.error ?? `PATCH ${path} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Fetch a file (with the session cookie) and trigger a browser download. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, `GET ${path} → ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// These objects mirror the .card/.btn/.input classes in globals.css (via CSS
// custom properties) so inline-styled components stay visually consistent with
// the class-based pages. Prefer the className in new code; these remain for the
// many existing components that use `style={card}` etc.
export const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border-soft)",
  borderRadius: 12,
  padding: 18,
  margin: "14px 0",
  boxShadow: "var(--shadow)",
};

export const btn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "var(--accent)",
  color: "#fff",
  border: "1px solid transparent",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

export const btnSecondary: React.CSSProperties = {
  ...btn,
  background: "#232d4d",
  color: "#ccd5f2",
  border: "1px solid var(--border)",
};

export const btnGhost: React.CSSProperties = {
  ...btn,
  background: "transparent",
  color: "var(--muted)",
  border: "1px solid var(--border)",
};

export const btnDanger: React.CSSProperties = {
  ...btn,
  background: "var(--danger-bg)",
  color: "var(--danger-fg)",
  border: "1px solid rgba(239,68,68,0.32)",
};

export const input: React.CSSProperties = {
  background: "#0c1226",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 11px",
  fontSize: 13,
};
