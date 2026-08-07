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
