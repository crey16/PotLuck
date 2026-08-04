/**
 * The version of the drill generators as a whole.
 *
 * Stored alongside anything whose meaning depends on how a question was
 * produced — today the M8.5B placement assessment, and in M9 every drill
 * attempt. Bump it whenever a generator change alters the difficulty or the
 * distribution of what it deals, so an old score is never silently reread
 * against a new instrument.
 *
 * Deliberately one number for all nine generators rather than one per kind:
 * M9 owns per-generator versioning together with the seed/signature metadata
 * it needs, and inventing half of that scheme here would leave two competing
 * versioning stories to reconcile.
 */
export const GENERATOR_VERSION = 1;
