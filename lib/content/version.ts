/**
 * The public-content version — the cache key for everything shipped, not
 * earned (M8.8C).
 *
 * Product content (modules, lesson bodies, scenario metadata) is identical for
 * every authenticated user, so it can be read once and reused across requests.
 * The thing that makes that safe rather than merely fast is a version that
 * changes whenever the content can have changed. This module is that version,
 * and it has **two independent parts** because content can ship two different
 * ways.
 *
 * ## 1. `SEED_FINGERPRINT` — the automatic half
 *
 * `supabase/seed.sql` is the only file in the repository that inserts into
 * `modules`, `lessons`, `scenarios`, `table_scenarios` or `daily_content` —
 * verified by the test beside this file, not assumed. It is therefore the
 * whole source of truth for shipped content, and its SHA-256 is a version that
 * nobody has to remember to bump: change the course, change the key.
 *
 * The constant is committed rather than hashed at runtime on purpose. A
 * serverless function cannot be relied on to have `supabase/` in its bundle —
 * the same trap that makes the solve pack live outside `public/` — and hashing
 * a 6,600-line file on the render path to save reading it would be a poor
 * trade. `version.test.ts` recomputes the hash and fails if the two disagree,
 * so the constant cannot silently go stale.
 *
 * ## 2. `CONTENT_VERSION` — the manual half
 *
 * A fingerprint of a repository file cannot see a row edited directly in the
 * production database. `CONTENT_VERSION` is the lever for that case: an
 * integer that already exists in `api/learning.py` and is already published at
 * `GET /api/content/version`, so this is adopting the project's existing
 * convention rather than inventing a parallel one. The test pins the two
 * copies together; they cannot drift.
 *
 * Raising it — in `api/learning.py`, here, and in the deployment's
 * `CONTENT_VERSION` environment variable, whichever the operator prefers as
 * the trigger — changes the cache key for every entry at once.
 *
 * ## What "old entries become unreachable" means here
 *
 * Nothing is purged. The key changes, so the next read misses and repopulates
 * under the new key; the old entry is simply never addressed again and expires
 * on its own. That is what makes this safe across a rolling deploy: two
 * instances on different versions read different keys rather than fighting
 * over one, and neither can serve the other's content.
 *
 * ## The TTL is a backstop, not the mechanism
 *
 * `PUBLIC_CONTENT_MAX_AGE_SECONDS` bounds how long an out-of-band database
 * edit can go unnoticed if nobody bumps anything. It is deliberately not the
 * invalidation story — an hour of staleness is a safety net under the version,
 * not a substitute for it.
 */

/**
 * SHA-256 of `supabase/seed.sql`, truncated to 16 hex characters.
 *
 * 64 bits is far more than enough to separate versions of one file — this is a
 * change detector, not a security boundary, and the accidental-collision risk
 * for a file edited a few dozen times is nil.
 */
export const SEED_FINGERPRINT = "2250a8fb54b2a8d8";

/**
 * Must equal `CONTENT_VERSION` in `api/learning.py`, which serves it at
 * `GET /api/content/version`. Pinned by `version.test.ts`.
 */
export const CONTENT_VERSION = 1;

/** How long a cached entry may survive with no version change. */
export const PUBLIC_CONTENT_MAX_AGE_SECONDS = 3600;

/** Tag for `revalidateTag`, so a purge does not have to know the key parts. */
export const PUBLIC_CONTENT_TAG = "public-content";

/**
 * The deployment's content version, allowing an environment override.
 *
 * The override exists so an operator can invalidate published content without
 * a code change — set `CONTENT_VERSION` in the deployment's environment and
 * redeploy. It is read through this one function so the parsing rule lives in
 * a single place: a value that is not a positive integer is ignored rather
 * than silently producing a key of `NaN`, which would be a cache that never
 * hits and never says why.
 */
export function contentVersion(): number {
  const raw = process.env.CONTENT_VERSION;
  if (raw === undefined) return CONTENT_VERSION;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return CONTENT_VERSION;
  return parsed;
}

/**
 * The cache key parts for every public-content entry.
 *
 * Returned as an array because that is the shape `unstable_cache` takes, and
 * because keeping both dimensions separate — rather than concatenating them
 * into one opaque string at the call site — is what stops a future caller from
 * accidentally dropping one of them.
 */
export function publicContentKeyParts(): string[] {
  return [`seed:${SEED_FINGERPRINT}`, `content:${contentVersion()}`];
}
