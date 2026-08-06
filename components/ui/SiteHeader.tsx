"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/env";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

const NAV = [
  { href: "/", label: "Home" },
  // Learn sits in the top bar, ahead of Drill, because it is the on-ramp: the
  // lessons teach the decision and the drills make it automatic. It used to
  // live in the account dropdown, two clicks deep behind an avatar, which is
  // the wrong place for the thing a new player should reach for first.
  { href: "/learn", label: "Learn" },
  { href: "/drill", label: "Drill" },
  // Play follows Drill because that is the progression: learn the decision,
  // make the math automatic, then apply both against real solver output. It
  // shipped in this bar in M6 and was swept into the account dropdown by the
  // redesign-v2 pass, which was cutting a nine-item nav down to five rather
  // than judging Play unfinished. It is the most substantial training surface
  // in the app and the one M10 builds on; buried behind an avatar it gets no
  // use and therefore generates no feedback about what M10 has to fix.
  { href: "/play", label: "Play" },
  { href: "/ranges", label: "Ranges" },
  { href: "/reference", label: "Reference" },
  // `/system` is deliberately absent. It is the design-system reference —
  // colour ramps, type scale, component states — which is developer
  // documentation, not something a player has any reason to open. The route
  // stays live and reachable by URL; it just does not spend a nav slot that
  // the player-facing on-ramp needs.
] as const;

const ACCOUNT_NAV = [
  { href: "/friends", label: "Friends" },
  { href: "/leaderboard", label: "Ranks" },
] as const;

export interface SiteHeaderProps {
  username?: string;
  displayName?: string;
  level?: number;
  streak?: number;
}

function writeThemeCookie(theme: Theme) {
  try {
    document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* cookies blocked — the toggle still works for this page view */
  }
}

export function SiteHeader({ username, displayName, level, streak }: SiteHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [acctOpen, setAcctOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const signedIn = username !== undefined;

  const toggleTheme = useCallback(() => {
    const root = document.documentElement;
    const next: Theme = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    writeThemeCookie(next);
  }, []);

  // Close the account menu on any outside click.
  useEffect(() => {
    if (!acctOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setAcctOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [acctOpen]);

  const handleSignOut = useCallback(async () => {
    setAcctOpen(false);
    if (supabaseConfigured()) {
      await createClient().auth.signOut();
    }
    router.push("/login");
    router.refresh();
  }, [router]);

  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="site-header">
      <div className="inner">
        <div className="site-brand" style={{ display: "flex", alignItems: "baseline", gap: 8, marginRight: "auto" }}>
          <Link
            href="/"
            style={{
              fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 19,
              letterSpacing: ".04em", textTransform: "uppercase", color: "var(--color-text)",
            }}
          >
            PotLuck
          </Link>
          <span
            className="site-brand-tagline"
            style={{
              fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".12em",
              textTransform: "uppercase", color: "var(--color-accent-700)",
            }}
          >
            poker math
          </span>
        </div>

        {signedIn && (
          <nav className="site-nav" aria-label="Primary" style={{ display: "flex", gap: 2 }}>
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="nav-btn"
                aria-current={isCurrent(n.href) ? "page" : undefined}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        )}

        <div
          className="site-actions"
          style={{
            display: "flex", alignItems: "center", gap: "var(--space-3)",
            paddingLeft: "var(--space-4)", borderLeft: "1px solid var(--color-divider)",
          }}
        >
          {signedIn && streak !== undefined && (
            <div
              className="site-streak"
              title="Days played in a row"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".06em",
                color: "var(--color-accent-700)",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="18" />
                <path d="M8 2v4M16 2v4M3 10h18" />
              </svg>
              <span className="site-streak-label">{streak}-DAY STREAK</span>
              <span className="site-streak-compact" aria-hidden="true">{streak}D</span>
            </div>
          )}

          {/* aria-label, not title: `title` is only a last-resort accessible
              name and is invisible on touch. The SVG is decorative. */}
          <button
            className="iconbtn"
            aria-label="Switch between light and dark theme"
            title="Light / dark"
            onClick={toggleTheme}
          >
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          </button>

          {signedIn && (
            <div style={{ position: "relative" }} ref={menuRef}>
              <button
                className="site-account-trigger"
                onClick={() => setAcctOpen((o) => !o)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  border: "1px solid var(--line)", borderRadius: 999, background: "var(--surface)",
                  color: "var(--color-text)", padding: "4px 10px 4px 4px", cursor: "pointer",
                  fontFamily: "var(--font-body)", fontSize: 13,
                }}
              >
                <span
                  style={{
                    width: 26, height: 26, borderRadius: 999, display: "grid", placeItems: "center",
                    background: "var(--color-accent)", color: "#fff",
                    fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 13,
                    textTransform: "uppercase",
                  }}
                >
                  {username.slice(0, 1)}
                </span>
                <span className="site-account-name">{username}</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>

              {acctOpen && (
                <div
                  className="blueprint"
                  style={{
                    position: "absolute", right: 0, top: "calc(100% + 10px)", width: 236,
                    background: "var(--surface)", boxShadow: "var(--lift)",
                    padding: "var(--space-3)", zIndex: 40,
                  }}
                >
                  <div className="mono-label" style={{ marginBottom: 6 }}>Account</div>
                  <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 17, lineHeight: 1.1 }}>
                    {displayName ?? username}
                  </div>
                  <div
                    style={{
                      fontSize: 12, color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
                      marginBottom: "var(--space-3)",
                    }}
                  >
                    @{username}{level !== undefined ? ` · Level ${level}` : ""}
                  </div>
                  <div
                    style={{
                      display: "flex", flexDirection: "column", gap: 1,
                      borderTop: "1px solid var(--color-divider)", paddingTop: "var(--space-2)",
                    }}
                  >
                    {ACCOUNT_NAV.map((item) => (
                      <Link
                        key={item.href}
                        className="menu-item"
                        href={item.href}
                        onClick={() => setAcctOpen(false)}
                      >
                        {item.label}
                      </Link>
                    ))}
                    <Link
                      className="menu-item"
                      href={`/u/${username}`}
                      onClick={() => setAcctOpen(false)}
                    >
                      Profile
                    </Link>
                    <button className="menu-item danger" onClick={handleSignOut}>
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
