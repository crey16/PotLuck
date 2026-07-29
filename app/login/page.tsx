"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Header } from "@/components/ui/Header";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/env";
import { safeNext } from "@/lib/supabase/authRules";

type Mode = "signin" | "signup";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "auth_callback"
      ? "Something went wrong finishing sign-in. Please try again."
      : null
  );
  const [pending, setPending] = useState(false);

  // If a session already exists (e.g. established in another tab, or this
  // page was reached before middleware caught up), bounce to the app.
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled && data.user) {
        router.replace(next);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  async function handleGoogle() {
    if (!configured) return;
    setError(null);
    const supabase = createClient();
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
    const supabase = createClient();
    const { error: authError } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setPending(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="wrap">
      <Header />
      <div className="panel" style={{ maxWidth: 420, margin: "0 auto" }}>
        <div className="prompt">Sign in</div>
        <p className="sub">Track XP, streaks, and progress across drills.</p>

        {!configured ? (
          <div className="note warnl">
            <b>Supabase is not configured.</b> Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code>.env.local</code> to enable sign in.
            The drill still works without an account.
          </div>
        ) : (
          <>
            <button type="button" className="btn ghost" style={{ width: "100%" }} onClick={handleGoogle}>
              Continue with Google
            </button>

            <div className="dividertext">or</div>

            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && <div className="error">{error}</div>}

              <div className="formrow">
                <button type="submit" className="btn" disabled={pending}>
                  {mode === "signin" ? "Sign in" : "Sign up"}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    setMode((m) => (m === "signin" ? "signup" : "signin"));
                  }}
                >
                  {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
