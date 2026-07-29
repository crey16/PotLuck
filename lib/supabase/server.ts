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
