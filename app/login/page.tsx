"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loadSupabaseClient } from "@/lib/supabase/lazyClient";
import { supabaseConfigured } from "@/lib/supabase/env";
import { postAuthDestination, safeNext } from "@/lib/supabase/authRules";
import { PasswordField } from "@/components/ui/PasswordField";

type Mode = "signin" | "signup" | "forgot";

/** Signed-out gate. Not rendered while /login is guarded by middleware for an
 * already-authenticated request, but a client-side check below covers the
 * case where a session is established after this page has already loaded.
 *
 * `useSearchParams()` requires a Suspense boundary in the App Router, so the
 * actual form lives in `LoginForm` below and this default export just wraps
 * it. */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const configured = supabaseConfigured();

  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);
  const [confirmSentTo, setConfirmSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "auth_callback"
      ? "Something went wrong finishing sign-in. Please try again."
      : null
  );
  const [pending, setPending] = useState(false);

  // If a session already exists (e.g. established in another tab, or this
  // page was reached before middleware caught up), bounce to the app.
  //
  // This also warms the SDK chunk for the handlers below (M8.8C). The form is
  // markup and state; only submitting it needs @supabase/supabase-js, so it is
  // fetched here in parallel with paint rather than bundled into the page. The
  // already-signed-in check has always run on mount, so this adds no request —
  // it moves 64 kB gzipped off the critical path and finishes long before
  // anyone has typed a password.
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    loadSupabaseClient()
      .then((supabase) => supabase.auth.getUser())
      .then(({ data }) => {
        if (!cancelled && data.user) {
          router.replace(next);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setResetSentTo(null);
    setConfirmSentTo(null);
  }

  async function handleGoogle() {
    if (!configured) return;
    setError(null);
    const supabase = await loadSupabaseClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (oauthError) setError(oauthError.message);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!configured) return;
    setError(null);
    setPending(true);
    const supabase = await loadSupabaseClient();

    if (mode === "forgot") {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      });
      setPending(false);
      if (resetError) setError(resetError.message);
      else setResetSentTo(email);
      return;
    }

    if (mode === "signin") {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      setPending(false);
      if (authError) {
        setError(authError.message);
        return;
      }
    } else {
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: username.trim() ? { data: { username: username.trim() } } : undefined,
      });
      setPending(false);
      if (authError) {
        setError(authError.message);
        return;
      }
      // Supabase obfuscates duplicate signups: it "succeeds" with a user that
      // has no identities. Without this check the user is told nothing and no
      // account or session exists.
      if (data.user && data.user.identities?.length === 0) {
        setError("An account with this email already exists — sign in instead.");
        setMode("signin");
        return;
      }
      // No session means confirm-email is on for the project: the account
      // exists but can't sign in until the link is clicked. Say so instead of
      // navigating into a redirect back to this page.
      if (!data.session) {
        setConfirmSentTo(email);
        return;
      }
    }
    // A brand-new account always goes to `/`, never to `next`.
    //
    // `next` is not usually a deliberate choice: middleware stamps it onto
    // every signed-out request, so arriving from a shared /learn/3/12 link or
    // simply from /drill puts a path there. Honouring it on SIGN-UP skips `/`,
    // which is the only route that runs the placement check — so the new
    // player is dropped straight into drills with no placement and no lessons,
    // which is exactly the flow this is meant to fix. A brand-new account has
    // no deep-link intent worth preserving; sign-IN still honours `next`.
    const destination = postAuthDestination(mode, next);

    // Full document navigation, not router.push: the session cookie was just
    // written, and a hard request guarantees middleware and every server
    // component see it. It also recovers from transient RSC-fetch failures
    // (observed 503s on client navigations right after auth) that leave a
    // soft navigation stranded on this page.
    window.location.assign(destination);
  }

  return (
    <>
      {/* Sibling of the grid, not a child: `.auth-layout` sets z-index 1, so a
          positioned child would paint over its own non-positioned siblings —
          which is exactly what hid the hero copy the first time round. */}
      <div className="auth-mesh" aria-hidden="true">
        <i /><i /><i /><i /><i /><i /><i />
      </div>
      <main className="auth-layout">
        <div>
          <div className="mono-label accent" style={{ letterSpacing: ".14em", marginBottom: "var(--space-3)" }}>
            Poker math trainer
          </div>
          <h1 style={{ fontSize: 58, lineHeight: 0.95, margin: "0 0 var(--space-4)", maxWidth: "20ch" }}>
            Learn the numbers until they are automatic.
          </h1>
          <p style={{ fontSize: 16, maxWidth: "52ch", color: "color-mix(in srgb, var(--color-text) 72%, transparent)" }}>
            Ten drills — outs, pot odds, EV, implied odds, bluff math, preflop ranges — each with
            its own adaptive difficulty and a worked derivation after every hand. Keyboard-first:
            1–4 to answer, N for the next hand.
          </p>
          <div
            style={{
              display: "flex", gap: "var(--space-6)", marginTop: "var(--space-6)", flexWrap: "wrap",
              fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
            }}
          >
            <span>10 drills</span>
            <span>8 skill tags</span>
            <span>169-cell range charts</span>
            <span>Free</span>
          </div>
        </div>

        <div className="blueprint" style={{ padding: "var(--space-6)", background: "var(--color-bg)" }}>
          <div style={{ display: "flex", gap: "var(--space-1)", marginBottom: "var(--space-6)", borderBottom: "1px solid var(--color-divider)" }}>
            <button className={`auth-tab${mode === "signin" ? " on" : ""}`} onClick={() => switchMode("signin")}>
              Sign in
            </button>
            <button className={`auth-tab${mode === "signup" ? " on" : ""}`} onClick={() => switchMode("signup")}>
              Create account
            </button>
            <button
              className={`auth-tab${mode === "forgot" ? " on" : ""}`}
              style={{ marginLeft: "auto" }}
              onClick={() => switchMode("forgot")}
            >
              Forgot?
            </button>
          </div>

          {!configured ? (
            <div className="note warnl" style={{ marginTop: 0 }}>
              <b>Supabase is not configured.</b> Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code>.env.local</code> to enable sign
              in. The drills still work without an account.
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {mode === "signin" && (
                <>
                  <h2 style={{ fontSize: 28, margin: "0 0 var(--space-2)" }}>Welcome back</h2>
                  <p style={{ fontSize: 13.5, color: "color-mix(in srgb, var(--color-text) 65%, transparent)", margin: "0 0 var(--space-4)" }}>
                    XP, streak and per-drill difficulty are on your account.
                  </p>
                  <button type="button" className="btn btn-secondary btn-block" style={{ minHeight: 40 }} onClick={handleGoogle}>
                    Continue with Google
                  </button>
                  <div className="or-rule">or</div>
                </>
              )}
              {mode === "signup" && (
                <>
                  <h2 style={{ fontSize: 28, margin: "0 0 var(--space-2)" }}>Create your account</h2>
                  <p style={{ fontSize: 13.5, color: "color-mix(in srgb, var(--color-text) 65%, transparent)", margin: "0 0 var(--space-4)" }}>
                    Pick a username — it is the name on your profile and, later, on leaderboards.
                  </p>
                  <div className="field" style={{ marginBottom: "var(--space-3)" }}>
                    <label htmlFor="username">Username</label>
                    <input
                      id="username"
                      className="input"
                      type="text"
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </div>
                </>
              )}
              {mode === "forgot" && (
                <>
                  <h2 style={{ fontSize: 28, margin: "0 0 var(--space-2)" }}>Reset your password</h2>
                  <p style={{ fontSize: 13.5, color: "color-mix(in srgb, var(--color-text) 65%, transparent)", margin: "0 0 var(--space-4)" }}>
                    We send a one-time link. It expires in an hour.
                  </p>
                </>
              )}

              <div className="field" style={{ marginBottom: "var(--space-3)" }}>
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {mode !== "forgot" && (
                <PasswordField
                  id="password"
                  label="Password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                  minLength={6}
                  value={password}
                  onChange={setPassword}
                />
              )}

              {mode === "signup" && password.length >= 6 && (
                <div
                  style={{
                    fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: ".06em",
                    textTransform: "uppercase", color: "var(--good)",
                    display: "flex", alignItems: "center", gap: 6, marginBottom: "var(--space-4)",
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  {password.length} characters — good
                </div>
              )}

              {error && <div className="error">{error}</div>}

              <button
                type="submit"
                className="btn btn-primary btn-block blueprint btn-caps"
                style={{ minHeight: 42, letterSpacing: ".05em" }}
                disabled={pending}
              >
                {pending
                  ? mode === "signin"
                    ? "Signing in…"
                    : mode === "signup"
                      ? "Creating account…"
                      : "Sending…"
                  : mode === "signin"
                    ? "Sign in"
                    : mode === "signup"
                      ? "Create account"
                      : "Send reset link"}
              </button>

              {mode === "signup" && confirmSentTo && (
                <div className="note" style={{ fontSize: 13 }}>
                  <b>Account created.</b> Check {confirmSentTo} for a confirmation link, then sign
                  in.
                </div>
              )}

              {mode === "forgot" && resetSentTo && (
                <div className="note" style={{ fontSize: 13 }}>
                  Sent. Check {resetSentTo} — the link signs you back in.
                </div>
              )}

              {mode === "signin" && (
                <p style={{ fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 60%, transparent)", margin: "var(--space-4) 0 0" }}>
                  No account?{" "}
                  <a
                    href="#signup"
                    onClick={(e) => {
                      e.preventDefault();
                      switchMode("signup");
                    }}
                  >
                    Create one
                  </a>{" "}
                  — the drills work either way, but nothing is saved without one.
                </p>
              )}
              {mode === "signup" && (
                <p style={{ fontSize: 12, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", margin: "var(--space-3) 0 0" }}>
                  Level 1, 0 XP, no streak yet. First correct answer starts it.
                </p>
              )}
              {mode === "forgot" && (
                <p style={{ fontSize: 12.5, margin: "var(--space-3) 0 0" }}>
                  <a
                    href="#signin"
                    onClick={(e) => {
                      e.preventDefault();
                      switchMode("signin");
                    }}
                  >
                    Back to sign in
                  </a>
                </p>
              )}
            </form>
          )}
        </div>
      </main>
    </>
  );
}
