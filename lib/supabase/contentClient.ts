import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A Supabase client with **no user attached** — for shipped content only.
 *
 * ## Why this cannot be the ordinary server client
 *
 * `lib/supabase/server.ts` builds its client from `cookies()`, which binds it
 * to one request and one signed-in person. A value produced by such a client
 * must never enter a cache shared across users, and Next agrees: a cached
 * function may not reach for `cookies()` at all. So a cached read needs a
 * client that never had a user in the first place, and this is it — built from
 * environment variables only, with no session to persist or refresh.
 *
 * That property is the point. It is not merely that this client happens to
 * return the same rows for everyone; it is that there is no identity in scope
 * for a per-user row to be selected by. A leak would require a caller to hand
 * it a user id explicitly, which `lib/content/publicContent.ts` never does and
 * its test forbids.
 *
 * ## Why the service role, and why it is optional
 *
 * The content tables carry `for select to authenticated using (true)` — every
 * signed-in account sees byte-identical rows, which is what makes the cache
 * sound. But `to authenticated` also means the anon key reads nothing, so a
 * userless client has to be the service role.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` is documented in `.env.example` but is not
 * required to run this app, so this returns `null` when it is absent rather
 * than throwing. Callers fall back to reading content through the request's
 * own authenticated client, uncached — identical results, no cross-request
 * reuse. Provisioning the key is what turns the shared cache on; nothing
 * breaks while it is missing.
 *
 * ## Server only
 *
 * This key bypasses RLS. It has no `NEXT_PUBLIC_` prefix, so Next will not
 * inline it into a client bundle, and `lib/content/publicContent.ts` — the
 * only importer — is server-only. Never import this from a client component.
 */
export function createContentClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createSupabaseClient(url, serviceKey, {
    auth: {
      // No cookie jar, no refresh timer, no storage: a request-scoped client
      // that outlives nothing. Leaving these on would have the SDK try to
      // persist a session that does not exist.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/** Whether the shared content cache can be used at all. */
export const contentCacheAvailable = (): boolean =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
