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
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

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
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and supabase.auth.getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (shouldRedirectToLogin(request.nextUrl.pathname, Boolean(user))) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // IMPORTANT: return supabaseResponse as-is — see cookie note above.
  return supabaseResponse;
}
