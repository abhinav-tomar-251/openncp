"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, isUnauthorized } from "./api";

export type SessionUser = { id: string; email: string; name: string | null };

/** Fetches the current user from /auth/me; redirects to /login on 401. */
export function useSession(): {
  user: SessionUser | null;
  loading: boolean;
  logout: () => Promise<void>;
} {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiGet<SessionUser>("/auth/me")
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch((e) => {
        if (!cancelled && isUnauthorized(e)) router.replace("/login");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout(): Promise<void> {
    await apiPost("/auth/logout");
    router.replace("/login");
  }

  return { user, loading, logout };
}
