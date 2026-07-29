import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-only Supabase client (anon key, RLS enforced). Callers must check
 * `supabaseConfigured()` (lib/supabase/env.ts) before calling this — it
 * throws if the env vars are missing rather than silently misbehaving,
 * since a browser client with an empty URL fails in confusing ways deep
 * inside the SDK.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
