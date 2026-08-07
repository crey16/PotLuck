/**
 * Pure redirect-decision logic for the auth middleware and the OAuth
 * callback route. Kept dependency-free (no next/headers, no cookies) so it
 * is unit-testable with plain node:test — see authRules.test.ts.
 */

/** Where an unauthenticated user lands, and where signed-in users bounce from. */
export const LOGIN_PATH = "/login";

/**
 * Default landing page once signed in — also safeNext's fallback. Deliberately
 * no `?tab=` so the default Mixed tab (the point of M2) wins. `/drill/outs`
 * still exists and redirects to `/drill?tab=outs`, preserving the URL M1
 * shipped, but nothing should route a fresh sign-in through that extra hop.
 */
export const DEFAULT_NEXT = "/drill";

/** Paths that are always allowed through, signed in or not. */
const PUBLIC_PREFIXES = [LOGIN_PATH, "/auth", "/api"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Should middleware redirect this request to /login?
 * - Never redirects /login, /auth/*, or /api/* (FastAPI owns /api; the
 *   callback route needs /auth/callback reachable while signed out).
 * - Otherwise redirects whenever there is no signed-in user.
 */
export function shouldRedirectToLogin(pathname: string, hasUser: boolean): boolean {
  if (isPublicPath(pathname)) return false;
  return !hasUser;
}

/**
 * Sanitize the `next` query param used by /login and /auth/callback so it
 * can only ever send the browser to a same-origin relative path. Rejects
 * absolute URLs (https://evil.com), protocol-relative URLs (//evil.com),
 * backslash variants (/\evil.com, /\\evil.com — WHATWG URL parsing treats
 * "\" as "/", so router.push would resolve these to https://evil.com/), and
 * anything else that doesn't start with a single leading slash.
 */
export function safeNext(raw: string | null): string {
  if (!raw) return DEFAULT_NEXT;
  // Reject protocol-relative ("//evil.com"), anything not starting with
  // exactly one leading slash (absolute URLs, javascript:, bare hostnames),
  // and any backslash (browsers normalize "\" to "/" before resolving).
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return DEFAULT_NEXT;
  return raw;
}

/** The three things the auth form can be doing. */
export type AuthMode = "signin" | "signup" | "forgot";

/**
 * Where to send the browser after a successful sign-in or sign-up.
 *
 * **Sign-UP always ignores `next`.** Middleware stamps `?next=` onto every
 * signed-out request, so arriving from a shared /learn/3/12 link or simply
 * from /drill puts a path there — it is almost never a deliberate choice.
 * Honouring it on sign-up skips `/`, which is the only route that runs the
 * placement check, and drops a brand-new player straight into drills with no
 * placement and no lessons. That is precisely the flow M8.5 exists to fix.
 *
 * A brand-new account has no deep-link intent worth preserving. Sign-IN still
 * honours `next`, because there the intent is real.
 *
 * Extracted from `app/login/page.tsx` because it was an inline expression
 * with no test, and it is the single rule the M8.5 routing depends on.
 */
export function postAuthDestination(mode: AuthMode, next: string): string {
  return mode === "signup" ? "/" : next;
}
