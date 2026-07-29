/**
 * Single source of truth for "is Supabase configured?". `.env.local` is
 * provided by the user and is git-ignored — it does not exist yet in this
 * checkout, so every Supabase-touching code path must check this first and
 * degrade gracefully instead of throwing. Never scatter ad-hoc
 * `process.env.NEXT_PUBLIC_SUPABASE_*` checks elsewhere; import this.
 */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
