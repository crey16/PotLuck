/**
 * The browser Supabase client, loaded off the first-paint path — M8.8C.
 *
 * ## Why this exists
 *
 * `@supabase/supabase-js` is 244 kB raw / 64 kB gzipped: auth, PostgREST,
 * Realtime, Storage and Functions in one entry point. Measured against the
 * production build, it was in the initial JS of **21 of the 22 routes** — not
 * because 21 routes talk to Supabase from the browser, but because
 * `SiteHeader` is in the root layout and statically imported `createClient` to
 * call `auth.signOut()` inside a click handler. One rare interaction put the
 * whole SDK in front of hydration on every page in the product.
 *
 * Only four browser code paths actually use it, and every one of them is
 * already asynchronous: signing out, recording a drill attempt, the
 * leaderboard's Realtime subscription, and the sign-in form. So the SDK can be
 * imported when it is used rather than when the page loads, with no change to
 * any caller's contract.
 *
 * ## Server code must not use this
 *
 * Server rendering has its own client in `./server.ts` with cookie-bound auth.
 * This module is browser-only, and deferring an import on the server would buy
 * nothing anyway — there is no bundle to shrink there.
 *
 * ## The import is shared, not repeated
 *
 * `import()` resolves to the same module record after the first call, so this
 * costs one network request per page load at most. `warmSupabaseClient` exists
 * for the case where the interaction is predictable but has not happened yet —
 * opening the account menu is a reliable signal that sign-out might be next,
 * and starting the fetch there means the click does not wait for it.
 */
import { supabaseConfigured } from "./env";

type BrowserClient = Awaited<ReturnType<typeof loadSupabaseClient>>;

let pending: Promise<typeof import("./client")> | null = null;

function loadModule(): Promise<typeof import("./client")> {
  pending ??= import("./client");
  return pending;
}

/**
 * The browser client, fetching the SDK chunk on first use.
 *
 * Callers must still check `supabaseConfigured()` first, exactly as they did
 * with the synchronous `createClient` — this throws for the same reason and in
 * the same case, so the guard did not move.
 */
export async function loadSupabaseClient() {
  const mod = await loadModule();
  return mod.createClient();
}

/**
 * Start fetching the SDK without needing it yet.
 *
 * Fire-and-forget on purpose: a failed preload must not surface as an unhandled
 * rejection or a visible error, because nothing has been asked for yet. The
 * real call re-awaits the same promise and reports the failure there, where
 * there is a user action to attach it to.
 */
export function warmSupabaseClient(): void {
  if (!supabaseConfigured()) return;
  void loadModule().catch(() => {
    // Retried by the next real call; `pending` is deliberately left in place so
    // a transient failure does not turn into a request storm.
  });
}

export type { BrowserClient };
