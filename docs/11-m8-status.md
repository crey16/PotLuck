# M8 status — durable play history and GTO telemetry

**Shipped to production 2026-08-03.** M8 replaces client-authored play grades
as the coaching record with a normalized, server-authoritative lifecycle. The
production database is migrated, the application is deployed, and the release
gate below was executed against production.

## What is implemented

- `0004_m8_play_history.sql` adds an immutable solve-pack/archive registry,
  normalized sessions, hands, decisions, and legal-action alternatives. Owner-
  only read policies are paired with trusted API-only writes and terminal
  `incomplete` / `completed` / `abandoned` lifecycles.
- The current artifact is pinned as `potluck:m6:srp-btn-bb:v1`. Its generated
  catalog hashes the manifest, all referenced solve files, grading metadata,
  and preflop frequencies generated from the canonical TypeScript ranges.
- The play API validates the frozen current-pack configuration, source hand,
  sequential node path, and chosen action. It re-derives frequency, verdict,
  EV loss, alternatives, analytics dimensions, and terminal replay snapshots.
- Decision writes and their `attempts`/XP/streak/skill/activity updates share
  one transaction. UUID idempotency and node uniqueness make retries harmless;
  a consistent profile → session → hand lock order prevents retry deadlocks.
- `/play` now creates the durable session and hand before accepting choices,
  pauses on save failures, retries with the same IDs, reconciles the trusted
  grade, and completes the server record before advancing. Signed-out play is
  explicitly labelled local-only.
- `/play/history` and `/play/history/[handId]` reload recent records and a full
  decision review, including provenance, version, alternatives, EV semantics,
  and recovery/abandon controls for interrupted hands.
- Compatible M6 attempts are preserved under the separate immutable
  `potluck:legacy-play-attempts:v1` archive. They remain visibly unverified,
  retain unknown EV where appropriate, and are excluded from coaching-quality
  aggregates.

The detailed identity, grading, EV, backfill, and access rules are in
`docs/10-m8-play-data-contract.md`.

## Verification record

- `python -m pytest -q api` — 124 passed.
- `npm test` — 282 passed; `npx tsc --noEmit` passed.
- `npm run lint` — zero errors (10 existing warnings, primarily vendored files
  under `.venv`); `npm run build` completed with both history routes present.
- `python supabase/tests/verify_m8_play_history.py` — disposable Postgres 16
  migration, malformed/duplicate legacy payload, immutability, grants,
  terminal-state, and two-user RLS checks passed.
- `python api/verify_play_lifecycle.py` — disposable migrated Postgres 16 route
  lifecycle passed, including concurrent lock ordering, exact retries, linked
  attempts/XP, terminal replay snapshots, recent reads, and full review.
- `npx tsx solver/gen-play-catalog.ts` reproduced the catalog byte-for-byte;
  `npx tsx solver/validate.ts` walked 25 flops, 5,000 instances, and 129,855
  hero paths with zero problems.

## Production release gate — executed 2026-08-03

Applied against production (Supabase Postgres 17.6, `potluck-poker.vercel.app`).

1. **Migration.** `0004_m8_play_history.sql` applied in one transaction through
   the session pooler (port 5432; the 6543 transaction pooler is not used for
   DDL). Created the five tables and archived all 8 pre-existing
   `drill_kind = play` attempts. `profiles` rows were asserted byte-identical
   across the transaction, so no XP or streak was disturbed.
2. **Deployment.** Pushed to `main`; Vercel auto-deployed. See the packaging
   defect below — the first deploy needed a follow-up fix before grading worked.
3. **Cutover audit.** `attempts` with `drill_kind = play` and no linked
   `play_decisions` row: **0**. No legacy write slipped through the window, so
   no delta archive was needed.
4. **Owner isolation.** Exercised at both layers. Through the API with a real
   token, another user's hand returned 404 for read and for `PATCH`. At the
   policy layer, `set local role authenticated` with a foreign `sub` saw 0 rows
   in all four tables while the owner saw its own 4 hands / 8 decisions, and a
   browser-role `update` was refused with `permission denied`.
5. **Lifecycle.** Session/hand/decision creation is idempotent — exact retries
   returned the same row with `xp_earned: 0`, and retries carrying changed data
   returned 409. A completed hand reloaded with all 3 decisions, their
   alternatives, and `alternatives_complete`. An interrupted hand reloaded as
   `incomplete` and abandoned cleanly; terminal status was enforced with 409.
6. **Grading provenance.** Preflop graded `reference_graded` /
   `reference-ranges:v1` with `ev_basis = unknown` and null EV — not zero.
   Postflop graded `validated` with `ev_basis = relative_to_best`.
7. **XP linkage.** 3 decisions produced exactly 3 distinct linked `attempts`
   rows and a profile XP delta of exactly +10 for the first graded decision.
   `POST /api/progress/attempts` with `drill_kind = play` returned 409.
8. **Legacy.** The archived session reports `total_ev_loss_bb = 0` and its 8
   decisions remain `legacy_unverified`, excluded from quality aggregates.

## Packaging defect found during rollout

The first production deploy returned 500 from every `POST /api/play/*`, while
the GET history routes worked. Vercel promotes `public/` to static assets and
strips it from the Python function bundle, so `api/play_solver.py` could not
read its own solve pack. `vercel.json`'s `includeFiles` does **not** fix this —
that option is unsupported in Next.js projects.

The fix moves the canonical pack to `solver/pack/srp-btn-bb/`, which ships with
the function like any other source directory, and generates the browser's
`public/solves/` copy at build and dev time via `scripts/sync-solve-pack.mjs`
(`prebuild` / `predev`; the copy is git-ignored). The pack bytes are unchanged,
so the content hash and the published `play_solve_packs` row stayed valid.

`GET /api/play/pack` was added as an authenticated diagnostic reporting pack
presence and the verified content hash, because Vercel function logs were not
reachable from the rollout environment. Production now reports
`verified: true`, 25 solve files, and
`sha256:ea2ec51324b7eac09c28c992b4cbd97248bda8d42d85624f372909c1cdbb6ca8`.
