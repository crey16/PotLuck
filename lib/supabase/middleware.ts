import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfigured } from "./env";
import { shouldRedirectToLogin, LOGIN_PATH } from "./authRules";

/**
 * The @supabase/ssr `updateSession` pattern, per current Supabase docs.
 *
 * Two things matter here and are easy to get subtly wrong:
 * 1. `setAll` writes cookies to BOTH `request.cookies` (so the rest of this
 *    request sees the refreshed session) AND a freshly-recreated
 *    `NextResponse.next({ request })` (so the browser sees it too). Writing
 *    to only one of the two is the classic "logged out on refresh" bug.
 * 2. We call `auth.getUser()`, not `getSession()` — `getSession()` reads the
 *    (possibly stale) cookie without validating it; `getUser()` revalidates
 *    against Supabase and is what actually refreshes an expiring token.
 *
 * `extraRequestHeaders` (M8.8A) are added to the headers the RENDER sees —
 * the request id and the route key. They are rebuilt from `request.headers` at
 * each `NextResponse.next` rather than captured once, because point 1 above
 * mutates `request.cookies` (and therefore the cookie header) in between; a
 * snapshot taken at the top would forward the pre-refresh session and
 * reintroduce the logged-out-on-refresh bug this comment exists to prevent.
 */
export async function updateSession(
  request: NextRequest,
  extraRequestHeaders?: Record<string, string>
) {
  const forwardedHeaders = () => {
    if (!extraRequestHeaders) return request.headers;
    const headers = new Headers(request.headers);
    for (const [name, value] of Object.entries(extraRequestHeaders)) {
      headers.set(name, value);
    }
    return headers;
  };

  let supabaseResponse = NextResponse.next({ request: { headers: forwardedHeaders() } });

  if (!supabaseConfigured()) {
    // Missing-env guard: no .env.local yet. Don't crash the whole app —
    // become a no-op passthrough so unauthenticated pages keep working.
    console.warn("[supabase] NEXT_PUBLIC_SUPABASE_URL / ANON_KEY not set — auth middleware is a no-op.");
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request: { headers: forwardedHeaders() } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and the auth check below.
  //
  // `getClaims()`, not `getUser()`: the project signs JWTs with ES256, so a
  // valid token verifies locally against a cached JWKS — no auth-server round
  // trip on every request, which was the biggest fixed cost on page loads. An
  // expired token still triggers a real network refresh inside getClaims, so
  // this keeps the middleware's session-refresh job intact.
  const { data, error } = await supabase.auth.getClaims();
  const user = error ? null : (data?.claims ?? null);

  if (shouldRedirectToLogin(request.nextUrl.pathname, Boolean(user))) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    const redirect = NextResponse.redirect(url);
    // An auth redirect must never be cacheable — M8.8C.
    //
    // `headers()` in next.config.ts matches on PATH, and its rules are applied
    // to whatever response comes back for that path, including this one. The
    // solve assets are served `immutable` for a year, so without this line a
    // signed-out request to a solve URL would hand a shared cache a
    // year-long "go to /login" for an address that must return JSON. Found by
    // reading the real response headers, not by reasoning about them: the
    // redirect carried `max-age=31536000, immutable`.
    //
    // Written for every redirect rather than just that path. The response
    // depends on a cookie, so it is per-user by definition and belongs in no
    // cache, shared or private, whatever rule a future path picks up.
    redirect.headers.set("Cache-Control", "no-store");
    return redirect;
  }

  // IMPORTANT: return supabaseResponse as-is — see cookie note above.
  return supabaseResponse;
}
