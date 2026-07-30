# M4 status — the learning path

Read this before starting M5. This records what shipped for M4, how it was
verified locally and in production, and the release fixes that later work
inherits.

**State: ✅ SHIPPED 2026-07-30.** The production database is migrated and
seeded, `main` is pushed, and the authenticated desktop/mobile walkthrough is
complete at **https://potluck-poker.vercel.app**.

The application release consists of `1144696` (M4), `7e926fa` (public-origin
server API routing), and `09a8daa` (mobile-safe authenticated header). The
earlier `672de0a` commit contains the auth/navigation and drill-balance fixes
that were already in the phase worktree.

## What a user can do

- Open `/learn` and see five ordered modules, exact lesson progress, a daily
  item, two practice labs, and a deterministic next recommendation.
- Open a module ledger and replay any lesson without artificial locking.
- Work through info, question, drill, and recap screens. Questions reveal and
  continue; drills require a correct retry; `1`–`4`, Enter/`N`, and Escape work.
- Earn lesson XP once, retain a server-derived first-try score, and improve the
  stored best score on later replays without farming lesson XP.
- Play authored one-decision hands at `/learn/practice` or reconstruct a full
  seat/action/stack/board spot at `/learn/table`; both are graded from stored
  server content and update shared skill statistics.
- Open `/daily` for the same deterministic item as every other user on that
  America/New_York date and claim the bonus once, only after completion evidence
  exists.

Home and the primary navigation both surface the learning path. A weak skill
with no authored lesson or exact-difficulty scenario falls through to a real
unfinished lesson or general scenario, so newer tags never dead-end.

## Architecture

| Piece | Location / rule |
|---|---|
| Course/content parsing | `lib/learn/content.ts`, fail-closed on malformed interactive screens |
| Server-rendered course reads | `lib/learn/server.ts`, authenticated Supabase client under RLS |
| Authenticated browser writes | `lib/learn/api.ts` → FastAPI; no lesson/scenario correctness flag |
| Lesson/progress/recommendation API | `api/learning.py` |
| Authored + table scenario API | `api/scenarios.py` |
| Daily + activity API | `api/daily.py` |
| Lesson-attempt migration | `supabase/migrations/0002_lesson_screen_attempts.sql` |
| Stable content catalog | `supabase/seed.sql` |
| Approved design | `docs/superpowers/specs/2026-07-30-milestone-4-learning-path-design.md` |

Lesson answers are graded against stored content and persisted with
`lesson_screen_index`. Completion requires every authored question/drill and
calculates first-try score from the earliest saved result per screen. The
profile row lock serializes progress, XP, level, streak, and activity updates;
lesson XP is zero on replay. Daily completion independently checks the assigned
lesson/scenario evidence before its own idempotent bonus insert.

Scenario and table-scenario submissions accept only content ID + choice ID.
The server validates that the choice exists, reads canonical/acceptable answers
and feedback from the content row, awards only the allowed first-attempt XP,
and updates the canonical shared skill tag.

## Content port and audit

`supabase/seed.sql` contains exactly 5 modules, 20 lessons, 33 authored
scenarios, and 20 table scenarios from the read-only StackSchool reference.
The seed has stable numeric IDs, four `ON CONFLICT (id) DO UPDATE` blocks, and
no delete/truncate/drop operation, so rerunning it does not reset user data.

The reference was treated as source material, not unquestioned poker truth.
Corrections include:

- a Royal Flush answer that previously pointed at the generic Straight Flush;
- one consistent pot convention (`pot after the bet`, plus the separate call)
  and corrected 16.7% / 20% / 33.3% examples;
- clean-vs-dirty outs, overlapping combo-draw outs, and the large-draw rule-of-4
  correction;
- preflop decisions aligned with `lib/poker/ranges.ts`, including positional
  action order and mixed acceptable choices;
- bankroll arithmetic (`20–25 × $200 = $4,000–$5,000`);
- made-hand, flush-strength, board-straight, range-advantage, pot-size, and
  “30% equity” wording errors in scenario/table content.

Regression tests parse every dollar-quoted JSON value, verify catalog counts,
validate all lesson/scenario correct-choice references, guard non-destructive
seed behavior, and pin the important corrected facts. The full SQL seed and M4
migration were also parsed successfully as PostgreSQL syntax during the local
audit.

## Local verification

- Python: full `api/` suite green, **65/65**.
- TypeScript: full `npm test` suite green, **226/226**, including safe Markdown,
  a server-render smoke test for the table-decision player, and five regression
  checks for server-to-API origin selection.
- `npx tsc --noEmit`: clean.
- `npm run lint`: 0 errors; the existing unused `categoryOf` warning in
  `lib/poker/engine.test.ts` remains unrelated. A locally ignored `.venv` can
  add Selenium vendor warnings when it is present.
- `npm run build`: successful; routes include `/learn`, module, lesson,
  `/learn/practice`, `/learn/table`, and `/daily`.
- Build warnings remain the known workspace-root/multiple-lockfile warning,
  Next's middleware→proxy deprecation, and Node 20's future Supabase warning.

## Production release verification

- Applied `supabase/migrations/0002_lesson_screen_attempts.sql` before the app
  release and verified `attempts_lesson_screen_idx` in production.
- Applied the non-destructive seed and verified exactly **5 active modules, 20
  active lessons, 33 active scenarios, and 20 active table scenarios**.
- Both `/api/health` and `/api/health/db` return 200 in production.
- An authenticated 22-check API walkthrough covered lesson answer authority,
  first completion and replay XP, premature/first/repeated daily claims,
  authored and table scenario grading/replay XP, recommendations, activity,
  lesson progress, signed-out protection, and owner-versus-second-user RLS.
- A browser walkthrough covered Home, course map, module, lesson, authored
  practice, table practice, and daily on desktop. A true 390 px pass then
  covered Home, all **5 modules**, all **20 lessons**, both practice modes, and
  daily with no unavailable/error state, no horizontal overflow, and zero
  severe console entries.

The browser pass caught two release-only defects before sign-off. Vercel can
protect its generated deployment URL, so server-rendered FastAPI reads now use
the public incoming domain with the stable production domain as fallback. The
authenticated header also wraps into a compact two-row mobile layout rather
than widening the document.

## Release gates — complete

1. [x] Production migration applied before application code.
2. [x] Production seed applied; 5 / 20 / 33 / 20 counts verified.
3. [x] Application deployed from `main`.
4. [x] Lesson first-completion, server-derived score, replay, question, and
   drill-retry behavior verified.
5. [x] Authored and table scenarios verified with canonical stats and replay XP.
6. [x] Daily precondition, first claim, repeat claim, and ET activity verified.
7. [x] Two-user RLS isolation and desktop/390 px browser layouts verified.

Google OAuth and the confirm-email decision remain the independent carried
items documented in `docs/04-roadmap.md`; neither blocks the email-authenticated
M4 release verification.
