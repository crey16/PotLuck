/** Stable identities shared by server-safe review code and the client API. */

/**
 * The pack new hands are dealt from. Must equal `SOLVE_PACK_ID` in
 * api/play_solver.py and a row in `play_solve_packs`, or session creation
 * 409s — the server compares the catalog on disk against the immutable
 * catalog row before it will open a session.
 *
 * v2 (M8.7A) added solved preflop EVs. The postflop solve files are
 * byte-identical to v1's, so a hand dealt under v1 still resolves to the same
 * instance; only preflop grading changed.
 */
export const PLAY_SOLVE_PACK_ID = "potluck:m87a:srp-btn-bb:v2";

/**
 * Packs that hands may still carry from before the current one. Reviewing a
 * historical hand must not fail merely because a newer pack has been
 * published — those rows keep their own grading fields and are never
 * retroactively restated.
 */
export const HISTORICAL_PLAY_SOLVE_PACK_IDS = ["potluck:m6:srp-btn-bb:v1"] as const;

export const LEGACY_PLAY_ARCHIVE_ID = "potluck:legacy-play-attempts:v1";

/**
 * The URL segment the browser fetches solve files under — M8.8C.
 *
 * The first 16 hex characters of the catalog's `content_hash`, which
 * `solver/gen-play-catalog.ts` computes over the manifest, every flop file,
 * the preflop pack and the canonical metadata. So this segment IS the pack's
 * content address, and `/solves/<spot>/<fingerprint>/…` is immutable by
 * construction: different bytes cannot produce the same path.
 *
 * That property is what earns the `immutable` cache header in
 * `next.config.ts`. Before this, the files sat at `/solves/<spot>/…` — a
 * mutable path that a republished pack would reuse, so a browser holding
 * `QsQh4d.json` from an older pack could keep serving it against a newer
 * grader. `immutable` was correctly rejected then; the naming is what makes it
 * safe now, not a bigger `max-age`.
 *
 * Pinned two ways: `scripts/sync-solve-pack.mjs` refuses to publish when this
 * disagrees with `catalog.json`, so a stale constant fails the build rather
 * than shipping a 404, and `constants.test.ts` checks the same thing in the
 * unit suite.
 */
export const PLAY_SOLVE_PACK_FINGERPRINT = "86901bebdba8356a";
