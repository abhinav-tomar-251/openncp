"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookIcon } from "./icons";
import type { SessionUser } from "../lib/useSession";

/**
 * Shared top navigation — brand, Guide link, user identity + logout. Takes
 * `user`/`onLogout` as props rather than calling useSession itself, so each page
 * keeps its own single session fetch (no duplicate /auth/me calls). Not used on
 * /login or /signup, which keep their minimal centered layout.
 */
export function AppHeader({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const pathname = usePathname();
  const onGuide = pathname?.startsWith("/guide");

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link href="/" className="nav-brand">
          OpenNPC
        </Link>
        <nav className="nav-links">
          <Link href="/guide" className={onGuide ? "nav-link nav-link-active" : "nav-link"}>
            <BookIcon size={14} /> Guide
          </Link>
        </nav>
        <div className="nav-user">
          <span className="muted">{user.email}</span>
          <button className="btn btn-ghost btn-sm" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
