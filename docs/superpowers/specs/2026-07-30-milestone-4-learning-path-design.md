# Milestone 4 design — learning path

**Status:** implemented locally, release verification pending, 2026-07-30

## Product job

PotLuck already tests poker knowledge. M4 adds the missing teaching loop:
choose a lesson, learn one idea in short screens, answer checks, finish once,
and receive a concrete next recommendation. The learning path is the primary
place to build knowledge; drills remain the place to make it automatic.

## Information architecture

- Add **Learn** to the primary navigation at `/learn`.
- `/learn` is the course map: next recommendation, today's lesson, and five
  modules in order with completion counts and a resume action.
- `/learn/[moduleId]` is a module ledger: description, progress meter, and
  every lesson in order. Lessons are never artificially locked; the first
  incomplete lesson is visually marked as next.
- `/learn/[moduleId]/[lessonId]` is the focused lesson player.
- `/learn/practice` is the authored-scenario player used when a recommendation
  has no matching unfinished lesson.
- `/learn/table` is the full-table decision lab for seeded table scenarios.
- `/daily` presents the deterministic daily item and awards its daily bonus
  only after the item is actually completed.

The home dashboard gets one compact “Learn next” panel linking into this
system. It remains a dashboard rather than duplicating the full course map.

## Industry-system visual language

The learning UI uses the existing blueprint primitives: square hairline
panels, registration marks, Barlow Condensed headings, monospaced uppercase
metadata, the existing accent token, and no new colour system.

The course map is a vertical technical drawing rather than a cartoon path.
Each module is a numbered blueprint plate connected by a one-pixel rule. A
filled accent rail and exact `n / total` label communicate progress without
colour alone. Completed items use a check and text; the current item uses an
accent border and “Next” label; later items remain fully accessible.

The lesson player is deliberately quieter than the dashboard:

- a narrow reading column with a top progress rule;
- one content plate per screen;
- numbered answer plates using the drill option language;
- a worked-feedback strip for questions and drills;
- a completion plate showing XP, streak, score, and the next route.

## Screen behaviour

Lesson content keeps the StackSchool behavioural contract:

1. `info`: render the authored Markdown and enable Continue immediately.
2. `question`: accept one answer, record it, reveal the correct answer, then
   enable Continue. A wrong answer does not block lesson completion.
3. `drill`: record every try and require the correct answer before Continue.
4. `recap`: render a “Key takeaway” treatment and finish the lesson.

Keys mirror drills: `1`–`4` choose an answer; `N` or Enter continues after an
answer; Escape returns to the module. Controls ignore key events originating
inside inputs or editable elements.

Completion is server-authoritative and idempotent. Each stored answer carries
its authored screen index. The server requires every interactive screen,
derives first-try score from those graded attempts, reads the XP reward from
stored lesson content, awards it only on first completion, updates
level/streak/daily activity in the same transaction, and returns zero lesson XP
on a replay. A replay needs fresh same-day attempts before it can drive a
streak or daily bonus. The success screen appears only after that write
succeeds; on failure, the player remains on the final screen with a retryable
error.

## Data and API boundaries

- Public authored content is server-rendered through the signed-in Supabase
  client under RLS; the FastAPI content endpoints also expose the documented
  API surface for other clients.
- All progress, grading, XP, streak, daily, and recommendation writes/logic go
  through FastAPI with the authenticated UUID from the JWT.
- Lesson answer correctness is derived on the server from `lesson_id`,
  `screen_index`, and `selected_choice_id`; the browser cannot supply a trusted
  correctness flag.
- Lesson answers update every lesson skill tag so existing drill and lesson
  evidence pools in `skill_stats`.
- Recommendation order is deterministic: weakest skill with at least five
  attempts → matching unfinished lesson → matching authored scenario at the
  accuracy-derived difficulty → first unfinished lesson → general scenario.
  Missing lesson/scenario coverage for a newer drill tag must fall through,
  never return a dead link.
- Daily selection is deterministic from the America/New_York date. Daily bonus
  completion is idempotent and the server verifies persisted completion or
  attempt evidence before awarding it.

## Content seeding

Port all reference content: 5 modules, 20 lessons, 33 authored scenarios, and
20 table scenarios. IDs are explicit and stable. The Supabase seed is safe to
re-run with `ON CONFLICT DO UPDATE`; it never deletes attempts, progress, daily
history, or skill stats from existing users.

## Accessibility and responsive rules

- Answer state always includes icon/text in addition to colour.
- Progress uses text plus a meter.
- Buttons retain visible focus outlines and native button semantics.
- At narrow widths the module rail becomes a single column, lesson metadata
  wraps, the player rail becomes static, and answer grids collapse to one
  column.
- Authored Markdown is rendered as React text nodes; raw HTML is never
  interpreted.

## Acceptance checks

- A new user can open Foundations, finish its first lesson, receive XP once,
  reload, and see the lesson and module marked complete.
- Replaying the lesson awards zero additional lesson XP.
- Quiz answers cannot be changed after reveal; drill answers can retry until
  correct; both write attempts and update lesson skill stats.
- The recommendation never points to absent content, including for
  `counting_outs`, `equity_estimation`, `implied_odds`, or `expected_value`.
- Every seeded lesson parses into supported screen types and every interactive
  screen has choices plus a valid correct choice.
- Daily content is the same for all users on a given ET date and its bonus can
  be awarded once per user per date.
- The authored and table-scenario players submit only a scenario ID and choice;
  correctness, acceptable alternatives, explanation, and XP come from stored
  server content.
- TypeScript tests, Python tests, lint, and the production Next build pass.
