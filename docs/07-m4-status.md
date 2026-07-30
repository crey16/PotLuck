# M4 status — the learning path

Read this before releasing M4 or starting M5. This records what is implemented
in the current worktree, what was verified locally, and what is still external
release work.

**State: local code-complete and production-build clean. Not migrated, seeded,
committed, pushed, or deployed. No authenticated production walkthrough has
been claimed.**

## What a user can do after release

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
- TypeScript: full `npm test` suite green, **221/221**, including safe Markdown and a
  server-render smoke test for the table-decision player.
- `npx tsc --noEmit`: clean.
- `npm run lint`: 0 errors; the existing unused `categoryOf` warning in
  `lib/poker/engine.test.ts` remains unrelated.
- `npm run build`: successful; routes include `/learn`, module, lesson,
  `/learn/practice`, `/learn/table`, and `/daily`.
- Build warnings remain the known workspace-root/multiple-lockfile warning,
  Next's middleware→proxy deprecation, and Node 20's future Supabase warning.

## Release gates — still outstanding

Do these in order; the API starts writing `lesson_screen_index`, so deploying
it before the migration would break lesson attempts.

1. Apply `supabase/migrations/0002_lesson_screen_attempts.sql` to production.
2. Apply `supabase/seed.sql` and verify 5 / 20 / 33 / 20 active content counts.
3. Deploy the application.
4. With an authenticated account, complete a new lesson, verify XP/progress,
   replay it for zero lesson XP, and exercise a wrong-question continue plus a
   wrong-drill retry.
5. Submit one authored scenario and one table scenario; verify attempt rows,
   canonical skill-stat increments, and first-attempt XP behavior.
6. Complete and retry the daily item; verify one bonus row/award for the ET date
   and a 409 when calling the bonus before the assigned content.
7. Repeat the two-account RLS isolation check and inspect mobile layouts before
   marking M4 shipped.

Google OAuth and the confirm-email decision remain the independent carried
items documented in `docs/04-roadmap.md`; neither blocks the email-authenticated
M4 release verification.
