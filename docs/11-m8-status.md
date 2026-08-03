# M8 status — durable play history and GTO telemetry

**Implemented and verified 2026-08-03; production release pending.** M8 replaces
client-authored play grades as the coaching record with a normalized,
server-authoritative lifecycle. The production database has not been migrated
and the application has not been deployed in this worktree, so the roadmap does
not call the milestone shipped yet.

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

## Production release gate

1. Quiesce legacy `/play` writes, or first release a compatibility backend that
   rejects generic `drill_kind = play` writes while the old UI is still live.
2. Apply `supabase/migrations/0004_m8_play_history.sql`, then deploy the API,
   generated catalog, `/play` persistence flow, and history UI.
3. Audit for any unlinked legacy play attempts created during the cutover. If
   writes were not fully quiesced, run a reviewed delta archive before calling
   the backfill complete.
4. With two authenticated accounts, verify owner-only session/hand/review
   reads, an interrupted reload, a completed reload, idempotent retries, and
   linked XP once per decision.
5. Confirm unverified legacy rows are labelled and excluded from EV/blunder
   totals, then mark M8 ✅ shipped in `docs/04-roadmap.md`.
