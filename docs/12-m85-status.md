# M8.5 — Lesson-first entry, placement, and honest answers

Status: **implemented and verified locally; migrations 0005 and 0006 are not
yet applied to production.** Read this before touching the landing route, the
drill answer contract, or placement.

Shipped in four independent parts, in the order D → C → A → B.

---

## M8.5D — The Rule of 2 and 4 tests counting

`lib/drill/kinds/rule24.ts`.

The prompt used to read *"You have N outs. What does the Rule of 2 and 4 give
you?"* — it handed the player half the answer, so the drill only ever tested one
multiplication. It now reads *"Count your outs…"* and the felt is the only
source of the count.

Settled decisions:

- **The draw label is hidden above level 1.** A named draw with a canonical
  count ("flush draw") *is* the answer once the player has to produce the
  number. Level 1 keeps it as a scaffold.
- **At level 1 the label only appears when it agrees with the true count.**
  `dealDrawSpot` enforces the CLAUDE.md label/count rule already;
  `dealVsHandSpot` does not, because dead outs mean a hero holding a flush draw
  can have 7 live outs rather than 9. `showsDrawLabel()` checks both conditions.
- **Distractors are built from real miscounts**, not arithmetic slips:
  `miscounts()` produces the textbook count for the named draw, the naive sum
  of a combo draw's parts (9 + 4 for "flush draw + gutshot", which is 12), and
  the count you get by ignoring dead outs. The rule is then applied to each.
  The one arithmetic distractor kept is the wrong side of the rule (×4 with one
  card to come), because that error makes a bad call look good.
- **The explanation leads with the count**, naming the out cards and the dead
  ones, so a wrong answer teaches the count rather than only the rule.

The answer is still `ruleOf2And4` over the evaluator's out count. Nothing is
hand-computed.

`lib/drill/kinds/concepts.ts` still contains two static bank items that state
an out count in their prompt. Those are the OMC concept bank, which M9 replaces
wholesale; they test the ×4 correction, not counting.

---

## M8.5C — "Not sure" as a first-class answer

Migration: `supabase/migrations/0005_m85_not_sure.sql`.

Every drill was multiple choice with no way to say "I don't know", so a lucky
guess and real knowledge were stored identically, and a shrug looked exactly
like a confident wrong belief. Those mean opposite things to a coach: one is a
gap to fill, the other a belief to correct. M11's weakness detection has to
separate them, so the separation is recorded now.

### The sentinel

`UNSURE` lives in `lib/drill/contract.ts` and is **deliberately not a member of
`DrillQuestion.options`**. Every generator would otherwise have to remember to
append it — and one that forgot would silently lose the affordance — while
`buildOpts` and the anti-repeat signature both walk the option list and would
have to learn to skip it. The renderer offers it beside the real choices
instead, via `components/ui/NotSureOption.tsx`, for every question everywhere.

`api/progress.py` has the matching `UNSURE_CHOICE_ID`.
`api/test_unsure_matches_typescript.py` pins them together, along with the
`ResponseType` union and the column's CHECK constraint.

### Grading

`gradeAnswer` gains an `"unsure"` grade. **`isRight` no longer means "not
wrong"** — that change is load-bearing: left alone, a shrug would have scored as
correct the moment the fourth grade existed.

### Difficulty — the rule that matters

`pushOutcome` drops an unsure answer from the rolling window **entirely**. Both
alternatives are wrong: recording it as a miss treats "I don't know" as a
confident error *and* makes "Not sure" the fastest route to easier questions
(six of them demote a level); recording it as a hit is simply false. Not
recording it means the player stays where they are until they commit.

`DRILL_STATE_SQL` filters `response_type = 'answer'` for the same reason. **If
these two ever disagree, a player's difficulty silently changes when they
refresh the page** — the seeded window would carry rows the live session
dropped. `test_unsure_matches_typescript.py` fails if either side loses its
filter.

### Storage and XP

- `attempts.response_type` — `'answer' | 'unsure'`, defaulted so every existing
  row stays valid. An unsure attempt is still `is_correct = false`, so accuracy
  keeps telling the truth; the column records *why*.
- `skill_stats.unsure_attempts` — counted inside `total_attempts`, never inside
  `correct_attempts`.
- `graded_correct()` re-derives correctness server-side, so no call site can
  earn XP for a shrug.
- Authored content (lessons, scenarios, table scenarios) recognises the
  sentinel **before** the "is this choice on the screen?" membership check.
  Without that, an honest "I don't know" 422s. The sentinel bypasses that check
  only — malformed content and a non-answerable screen index still raise.

A `drill` lesson screen still requires a correct answer to clear, so "Not sure"
there shows the answer and asks the player to retake it. That is intentional.

---

## M8.5A — Lessons as the landing surface

Signing in landed on a statistics dashboard with the learning path three
screens down. The training loop is lesson-first, so the path now leads.

- `/` opens with the next lesson, its module and path progress, then the course
  map. Streak, XP, accuracy, weakest skill and the skill rows moved into "Your
  progress"; the drill cards follow.
- The deterministic recommendation is still there, demoted to a quiet
  "Recommended practice" row. It must never displace the path as the main
  action.
- `/learn` is unchanged as the canonical, directly linkable home of the path
  and keeps its nav item.
- **Both routes render one implementation**: `components/learn/CourseMap.tsx`
  and `components/learn/ContinuePath.tsx`.
  `components/learn/coursePathSingleSource.test.ts` fails if either route
  re-declares the course-map markup. A forked copy would silently disagree
  about completion the first time either changed.
- The logged-out route is untouched.

### Two traps `lib/learn/path.ts` exists to avoid

1. **`ModuleWithProgress.nextLessonId` is not the next lesson.** It falls back
   to the module's *first* lesson once the module is complete, so reading it
   would tell a player who has finished the course to start again at lesson 1.
   `nextPathStep` derives from `completedLessonIds` instead.
2. **`completedLessonIds.size` is not the completed count.** It counts progress
   rows, which can include a lesson since deactivated — it will report 21 / 20.
   `pathProgress` counts against active lessons only.

---

## M8.5B — New-user placement assessment

Migration: `supabase/migrations/0006_m85_placement.sql`.
Blueprint: `lib/placement/blueprint.ts`. API: `api/placement.py`.
Route: `/placement`.

A new account started at level 1 with no history, so the recommender served the
first lesson of the first module to everyone — a player who knows pot odds cold
was taught what a pot is.

### The instrument

**Nine questions, one per drill kind**, covering all eight canonical skill tags
(`potodds` and `decision` share `pot_odds` — a call/fold spot *is* a pot-odds
question). Drawn from the existing tested generators, not a new authored bank,
so placement is derived from the same math as the drills it places into.

Every question is dealt at **level 2**. Level 1 is answerable by anyone who can
multiply and separates nobody; level 3 fails almost everyone and separates
nobody either.

Questions are regenerated from `(assessment_version, seed, index)`, so a
reported bad placement question can be reproduced exactly. `"Not sure"` is
offered throughout — for a brand-new player it is the most informative answer
available.

### What the result does

- **Per drill kind:** a correct answer starts that drill at level 2, applied as
  a **floor**, not an override. A player whose real history says level 3 is
  never pulled down, and once the rolling window reaches `MIN_SAMPLE` the floor
  stops applying — those answers are better evidence than one question.
  Placement can never award level 3; the adaptive window promotes there after
  six answers at 80% anyway.
- **Path entry:** overall accuracy maps to a module index using the settled
  StackSchool thresholds (`< 0.40`, `< 0.75`) already used by
  `difficulty_for_accuracy`, so placement, recommendations and drill difficulty
  share one accuracy vocabulary. **Capped at module index 2** — nine questions
  of poker math say nothing about bankroll discipline, and being placed past
  material you have not shown is worse than being placed under it.
- **Lessons before the entry module** get `progress.status = 'placed_out'` —
  a distinct status, never `'completed'`. The player did not take them, and
  saying they did would make the completion meter claim work that never
  happened. `fetchLearningPath` treats it as satisfied; the lessons stay open.
- **An unsure answer places like a miss.** It is not a confident error, but it
  is not a demonstration either, and "Not sure" must never be the profitable
  answer.

### The XP rule, stated deliberately

Placement writes **nothing** to `attempts`, awards **no XP**, touches **no**
streak or daily-activity row, and never reaches `skill_stats`. It has its own
tables. `test_placement_matches_typescript.py` fails if `api/placement.py` ever
references those tables — reusing the generic attempt path is exactly the
accident this guards against.

### Never a gate

- `/` redirects a brand-new account to `/placement` **once**: only when no
  assessment row exists *and* the account has never answered anything. An
  established player is never interrupted.
- Starting, completing **or skipping** all write a row, after which the
  redirect never fires again.
- A skip applies nothing — no levels, no placed-out lessons, module index 0 —
  which is exactly today's cold start.
- `/placement` is always reachable and linked from `/learn`, so it can be
  retaken.

### Versioning

Both `assessment_version` and `generator_version` are stored on every row. The
drill-state endpoint applies placement levels **only when both match today's**:
a placement scored by different rules or dealt by different generators measured
something else, and an outdated result stops applying rather than being
silently reinterpreted.

---

## Release gate — NOT YET RUN

Both migrations are written and locally consistent, but neither is applied to
production. Before shipping:

- [ ] Apply `0005_m85_not_sure.sql` and `0006_m85_placement.sql` in order.
- [ ] Verify existing `attempts` rows defaulted to `response_type = 'answer'`
      and that drill difficulty is unchanged for an established account.
- [ ] Answer "Not sure" in a drill, a lesson question, a scenario and a table
      scenario; confirm each stores `response_type = 'unsure'`, earns 0 XP, and
      increments `skill_stats.unsure_attempts` but not `correct_attempts`.
- [ ] Confirm a run of "Not sure" answers does not demote a drill, before or
      after a reload.
- [ ] Create a fresh account, confirm the redirect into `/placement`, complete
      it, and check the entry module, the `placed_out` rows and the drill
      levels it produced.
- [ ] Create a second fresh account and **skip**; confirm it lands on module 1
      at level 1 everywhere, and is not redirected again.
- [ ] Confirm with two accounts that neither can read the other's
      `placement_assessments` or `placement_responses`.
- [ ] Confirm an established account is never redirected into placement.
