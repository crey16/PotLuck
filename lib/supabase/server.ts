import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Server Component / Route Handler Supabase client. Callers must check
 * `supabaseConfigured()` (lib/supabase/env.ts) before calling this.
 *
 * `setAll` is wrapped in try/catch: Server Components can't write cookies
 * (Next throws if you try), so writes there are silently dropped — that's
 * fine because middleware (`lib/supabase/middleware.ts`) is what refreshes
 * and persists the session cookie on every request.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component — no-op, middleware handles it.
          }
        },
      },
    }
  );
}

/**
 * The signed-in user's id, or null — request-cached so the layout and the
 * page share one check per request instead of each paying for their own.
 *
 * Uses `getClaims()`, not `getUser()`: the project signs JWTs with ES256, so
 * the token is verified locally against a module-cached JWKS — no round trip
 * to the auth server on the render path. Middleware already revalidated and
 * refreshed the session for this request; this only needs to read it safely.
 */
export const getAuthUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  return data.claims.sub ?? null;
});
