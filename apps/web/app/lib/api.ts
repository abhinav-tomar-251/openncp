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

export const card: React.CSSProperties = {
  background: "#151b33",
  border: "1px solid #283157",
  borderRadius: 10,
  padding: 16,
  margin: "12px 0",
};

export const btn: React.CSSProperties = {
  background: "#3b82f6",
  color: "white",
  border: "none",
  borderRadius: 8,
  padding: "8px 14px",
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-block",
};

export const input: React.CSSProperties = {
  background: "#0b1020",
  color: "#e6e9f2",
  border: "1px solid #283157",
  borderRadius: 8,
  padding: "8px 10px",
};
