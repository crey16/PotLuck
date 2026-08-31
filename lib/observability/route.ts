/**
 * Turning a URL into a grouping key — M8.8A.
 *
 * Every number in the baseline is grouped by something. That something must be
 * a **route pattern**, never a URL, for two independent reasons:
 *
 * 1. **Cardinality.** `/u/alice`, `/u/bob`, `/u/carol` are one route with one
 *    latency distribution. Keyed by URL they are three groups of n=1, and no
 *    percentile in the report means anything.
 * 2. **Disclosure.** `/u/alice` names a real person, and
 *    `/login?next=/play/history/9f2…` carries wherever they were going. A
 *    performance log is a low-ceremony artifact — it gets tailed, pasted into
 *    issues, and shipped to whatever collector comes next. It has no business
 *    holding either.
 *
 * So `routeKey()` drops the query string entirely and replaces dynamic segments
 * with the App Router's own bracket names. `PATTERNS` is written against
 * `app/`'s directory layout; `route.test.ts` walks `app/` and fails when a
 * dynamic route exists that has no pattern here, so a new `[id]` route cannot
 * quietly start logging raw ids.
 *
 * **The query string is dropped, not filtered.** A filter is an allowlist that
 * someone extends under deadline; dropping is a property. The one query
 * parameter this app puts anywhere near a log is `?next=`, which middleware
 * stamps on every signed-out request — precisely the value that must not be
 * kept.
 *
 * Anything that matches no pattern collapses to `/other`, which bounds the key
 * space absolutely: a crawler hitting ten thousand invented paths adds one row,
 * not ten thousand.
 */

/**
 * Concrete path → App Router pattern. Order matters: the first match wins, so
 * more specific patterns come first.
 *
 * Each entry is a regex over the pathname and the pattern it stands for.
 */
const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/u\/[^/]+$/, "/u/[username]"],
  [/^\/games\/[^/]+\/session\/[^/]+$/, "/games/[groupId]/session/[sessionId]"],
  [/^\/games\/[^/]+$/, "/games/[groupId]"],
  [/^\/play\/history\/[^/]+$/, "/play/history/[handId]"],
  [/^\/learn\/[0-9]+\/[0-9]+$/, "/learn/[moduleId]/[lessonId]"],
  [/^\/learn\/[0-9]+$/, "/learn/[moduleId]"],
];

/** Static routes this app serves. Anything outside becomes `/other`. */
const STATIC_ROUTES: ReadonlySet<string> = new Set([
  "/",
  "/daily",
  "/drill",
  "/drill/outs",
  "/friends",
  "/games",
  "/leaderboard",
  "/learn",
  "/learn/practice",
  "/learn/table",
  "/login",
  "/placement",
  "/play",
  "/play/history",
  "/ranges",
  "/reference",
  "/system",
]);

/** The bucket everything unrecognised falls into. */
export const OTHER_ROUTE = "/other";

/**
 * A bounded, non-identifying key for a pathname.
 *
 * Accepts a pathname or a full URL; a full URL's query and hash are discarded
 * along with its origin.
 */
export function routeKey(input: string | null | undefined): string {
  if (typeof input !== "string" || input.length === 0) return OTHER_ROUTE;

  let pathname = input;
  // A full URL, or anything carrying a query/hash, is reduced to its path.
  // `URL` with a dummy base handles both absolute and relative forms and
  // cannot throw for a plain path.
  try {
    pathname = new URL(input, "http://x").pathname;
  } catch {
    return OTHER_ROUTE;
  }

  // Trailing slash is not a distinct route to this app.
  if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);

  if (STATIC_ROUTES.has(pathname)) return pathname;
  for (const [pattern, key] of PATTERNS) {
    if (pattern.test(pathname)) return key;
  }
  return OTHER_ROUTE;
}

/**
 * There is deliberately no `apiRouteKey` here.
 *
 * The API surface belongs to FastAPI, and FastAPI already knows the template
 * it matched — `api/observability.py` reads `scope["route"].path`, which gives
 * `/api/play/hands/{hand_id}` for free and cannot drift from the decorators.
 * A second, hand-maintained copy of the route table in TypeScript would drift
 * (CLAUDE.md records exactly that happening to `docs/03-api-surface.md`), and
 * any regex broad enough to cover the surface without one is also broad enough
 * to let an invented `/api/<random>` mint a new key per request.
 */
