# Milestone 2 design — the full drill set

Approved 2026-07-29. Supersedes nothing; extends the M1 design in
`2026-07-29-milestone-1-design.md`.

M2 turns the single outs drill into the nine-module trainer the reference HTML
describes, with per-drill adaptive difficulty and per-skill stats. The two
carryovers from M1 (Google OAuth, the confirm-email decision) are deliberately
sequenced **last** — they are plumbing, and the drills are the product.

## Scope

**In:**

- Nine drill generators: counting outs, rule of 2 & 4, pot odds, call or fold,
  implied odds, expected value, bluff math, OMC mistakes, preflop.
- Mixed mode that deals from all nine.
- Per-drill adaptive difficulty (levels 1–3) from a rolling last-10 window,
  seeded from the database so it survives reloads.
- Two opponent modes: unknown (default) and face-up, with dead outs shown.
- Every answer recorded as an `attempts` row with `drill_kind` + `drill_payload`,
  and a `skill_stats` upsert in the same transaction.
- A Reference tab: the written cheat-sheet ported from the reference HTML.
- Google OAuth provider, and the confirm-email decision — both at the end.

**Out (with the milestone that owns them):**

- Server-side re-grading of drill answers — M3, when leaderboards make XP
  competitive. The design keeps the door open (see Payloads) but builds nothing.
- Per-drill accuracy dots on the tabs — M6.
- Generalised A–D keyboard shortcuts, the deferred `e.target` guard, aria
  attributes on drill controls — M6. M2 keeps exactly the keys M1 already has.
- Range-chart explore mode, the 13×13 browser — M3. M2 uses the grid only
  inside the preflop drill's explanation.
- Theme toggle, 4-colour deck toggle — M6.

## Architecture

Chosen from three candidates. The alternatives were generators returning JSX
(rejected: puts `lib/drill` behind React and hides arithmetic inside markup,
which is exactly where a plausible-but-wrong number survives) and nine
self-contained React components (rejected: writes the answer/feedback/difficulty
state machine nine times and turns one review into nine).

```
lib/drill/
  contract.ts        DrillQuestion, ViewBlock, Explain, DrillKind
  grade.ts           gradeAnswer(question, chosen) — the ONLY grader
  difficulty.ts      nextLevel(window, current) — pure
  rng.ts             mulberry32 seeded PRNG, for deterministic tests
  registry.ts        the nine kinds + Mixed
  kinds/
    outs.ts  rule24.ts  potodds.ts  decision.ts  implied.ts
    ev.ts    bluff.ts   concepts.ts  preflop.ts        (+ one .test.ts each)
components/drill/
  DrillPlayer.tsx    renders ANY DrillQuestion
  DrillTabs.tsx      Mixed + 9 + Reference
  ReferenceTab.tsx   static cheat-sheet
  DrillShell.tsx     (exists) stats, difficulty windows, persistence
app/drill/
  page.tsx           the tabbed drill page, ?tab=<kind>
  outs/page.tsx      (exists) → redirect to /drill?tab=outs
api/
  skills.py          drill_kind → skill_tag map (single source of truth)
  index.py           + GET /api/progress/drill-state, skill_stats upsert
```

Each generator is a pure function of `(level, ctx)` returning data. No React, no
HTML strings, no DOM. That is what makes them independently testable and what
makes the nine of them a genuine parallel fan-out rather than nine agents
editing overlapping components.

### The contract

```ts
export type DrillKind =
  | "outs" | "rule24" | "potodds" | "decision" | "implied"
  | "ev" | "bluff" | "concepts" | "preflop";

export type OppMode = "unknown" | "shown";

export interface DrillContext {
  level: 1 | 2 | 3;
  oppMode: OppMode;
  rng: () => number;
}

/** Everything a question can put on screen. Data only. */
export type ViewBlock =
  | { type: "felt"; hero: Card[]; board: Card[]; villain?: Card[] }
  | { type: "hand"; label: string; cards: Card[] }
  | { type: "money"; items: { label: string; value: string }[] }
  | { type: "grid"; scenarioId: string; highlight?: string }
  | { type: "text"; text: string; tone?: "plain" | "warn" };

export interface Explain {
  rows: { label: string; value: string }[];
  notes: { tone: "plain" | "warn" | "good"; title?: string; text: string }[];
  blocks?: ViewBlock[];
}

export interface DrillQuestion {
  kind: DrillKind;
  kicker: string;
  chip?: string;
  prompt: string;
  sub?: string;
  body: ViewBlock[];
  options: { label: string; value: string | number }[];
  answer: string | number;
  acceptable?: (string | number)[];
  layout: "one" | "two" | "grid3";
  explain: (chosen: string | number) => Explain;
  payload: Record<string, unknown>;
}

export type Generator = (ctx: DrillContext) => DrillQuestion;
```

Three decisions inside it:

1. **`acceptable` is data, not a predicate.** The reference uses
   `isCorrect: v => f[v] >= 0.2` for preflop, because a mixed-strategy hand has
   more than one defensible action. A predicate cannot be serialised, snapshot
   in a test fixture, or replayed server-side in M3. Preflop instead enumerates
   every action the scenario takes at ≥20% frequency into `acceptable`.
2. **Grading lives in one function.** `gradeAnswer(q, chosen)` returns
   `"correct" | "acceptable" | "wrong"`; `DrillPlayer` derives all button states
   from it. Nine generators cannot disagree about what "right" means.
3. **`explain` is a function of the chosen answer**, because the feedback
   references what you picked. It stays pure, so tests assert on returned rows
   without rendering.

`skillTag` is deliberately **not** on `DrillQuestion`. The `drill_kind →
skill_tag` map lives only in `api/skills.py`; the client sends `drill_kind` and
the server derives the tag. One source of truth, and no way for the browser to
report a tag it got wrong.

### Payloads

`drill_payload` must be sufficient to re-derive the correct answer, so that M3
can re-grade server-side without a schema change.

| Kind | Payload |
|---|---|
| `outs`, `rule24` | `{ level, oppMode, spot }` — `spot` is the M1 `Spot` shape verbatim |
| `potodds`, `decision`, `implied`, `ev`, `bluff` | `{ level, oppMode, spot?, pot, bet, call, ... }` — every number the question showed |
| `concepts` | `{ level, oppMode, conceptId }` |
| `preflop` | `{ level, oppMode, scenarioId, hand, cards }` |

Every payload carries `level` and `oppMode`. Nothing derived (no equity, no out
count) is stored — those are recomputed, never trusted.

Note the one break with M1: M1 wrote the bare `Spot` at the root of
`drill_payload`, and M2 nests it under `spot` alongside `level`/`oppMode`. The
`Spot` shape itself is unchanged, so M3's re-grader distinguishes the two by
`"spot" in payload` — a one-line branch, recorded here so it is not a surprise.
Existing rows are not migrated.

## Adaptive difficulty

`lib/drill/difficulty.ts`, a verbatim-semantics port of the reference's
`levelFrom()`, as one pure function:

```
nextLevel(window: boolean[], current: 1|2|3): 1|2|3
  - window is the last 10 results for THIS drill kind
  - fewer than 6 entries        → current, unchanged
  - accuracy ≥ 0.80             → min(3, current + 1)
  - accuracy <  0.50            → max(1, current - 1)
  - otherwise                   → current
```

Boundaries are inclusive as written: exactly 0.80 promotes, exactly 0.50 does
not demote. Tests pin both.

**Per-drill, not global.** Nine independent windows, keyed by `DrillKind`, each
capped at 10. Being sharp at pot odds must not hand you level-3 outs hands.
Mixed mode picks a kind, then reads that kind's window.

**Seeded from the server.** `GET /api/progress/drill-state` returns, per
`drill_kind`, the last 10 `is_correct` values (oldest-first, so the client can
append) plus lifetime totals:

```sql
select drill_kind, is_correct, rn from (
  select drill_kind, is_correct,
         row_number() over (partition by drill_kind
                            order by created_at desc, id desc) as rn
  from attempts
  where user_id = %s and drill_kind is not null
) t
where rn <= 10
order by drill_kind, rn desc;
```

Lifetime totals come from a second aggregate over the same predicate. The
endpoint is read-only, RLS-scoped by `user_id` from the JWT, and fails soft:
if it errors or the user is signed out, every window starts empty and
difficulty starts at 1. It is never on the critical path for dealing a hand.

`DrillShell` owns the windows in React state, appends each result as it is
answered, and recomputes the level for a kind at deal time — matching the
reference, where `newQuestion()` recomputes level before generating.

## Persistence

`POST /api/progress/attempts` gains one step inside the existing transaction,
between the attempt insert and the XP update:

```sql
insert into skill_stats (user_id, skill_tag, total_attempts, correct_attempts)
values (%s, %s, 1, %s)
on conflict (user_id, skill_tag) do update
set total_attempts   = skill_stats.total_attempts + 1,
    correct_attempts = skill_stats.correct_attempts + excluded.correct_attempts;
```

The tag comes from `api/skills.py`. Where StackSchool already has a tag that
genuinely matches, we reuse it, so drill accuracy and lesson accuracy pool into
the same stat and M4's recommendations can send a botched pot-odds drill to the
pot-odds lesson:

| `drill_kind` | `skill_tag` | Source |
|---|---|---|
| `potodds` | `pot_odds` | existing |
| `decision` | `pot_odds` | existing |
| `bluff` | `bluffing` | existing |
| `concepts` | `discipline` | existing |
| `preflop` | `hand_selection` | existing |
| `outs` | `counting_outs` | new |
| `rule24` | `equity_estimation` | new |
| `implied` | `implied_odds` | new |
| `ev` | `expected_value` | new |

`decision` and `potodds` share `pot_odds` on purpose: "call or fold" *is* a pot
odds question with the arithmetic hidden. M4 must tolerate a weakest tag that
has no lesson behind it (the four new tags) — noted here so it is designed for,
not discovered.

Two other changes to the endpoint, both cheap and both closing M1 deferrals:

- `AttemptIn.drill_kind` becomes `Literal[...]` over the nine kinds, and
  `answer` gets a `max_length`. An unknown kind is now a 422, not a row that
  silently never maps to a skill tag.
- XP is unchanged: 10 for a correct answer, 0 otherwise. The reference's
  `10 × level + streak bonus` score becomes the **session Score tile only** and
  is never written to `profiles.xp` — M3's leaderboards must not reward
  cranking difficulty.

## UI

`/drill` is one client page holding a tab strip and one panel, ported from the
reference's shape. The active tab is mirrored to `?tab=<kind>` so a reload keeps
your place without nine routes. `/drill/outs` becomes a redirect to
`/drill?tab=outs`, so the URL M1 shipped keeps working.

- **Tabs:** Mixed · Count outs · Rule of 2 & 4 · Pot odds · Call or fold ·
  Implied odds · Expected value · Bluff math · OMC mistakes · Preflop ·
  Reference. No accuracy dots (M6).
- **Header:** adds an Opponent toggle — `unknown` (default) / `face-up` —
  persisted in `localStorage`, and it reshuffles the current hand when flipped,
  because the dealt spot depends on the mode.
- **Stat tiles:** Score (session), Accuracy (session), Streak (session, with
  best), Difficulty (1–3 with pips). The tile M1 labelled "Level" is renamed
  **Difficulty**; XP level appears in the page header only, so the two numbers
  are never confused again.
- **`DrillPlayer`** renders any `DrillQuestion` by mapping `ViewBlock`s onto the
  components M1 already built (`Felt`, `PlayingCard`, `WorkTable`,
  `FeedbackPanel`, `OptionButton`, `StatTile`). Keys stay exactly M1's: `1`–`4`
  to answer, `N` / Enter for the next hand.
- **Face-up mode** applies to every kind that deals a villain (`outs`,
  `rule24`, `potodds`, `decision`, `implied`, `ev`): outs become the cards that
  actually beat the villain's hand, dead outs are listed and explained, and the
  equity row reads "Exact equity vs their hand" rather than "Chance of hitting".
  `concepts` and `preflop` ignore the mode.
- **Reference tab** is static content — the pot-odds table, rule of 2 & 4 with
  the >8-outs correction, MDF, bluff math, and the OMC mistake list — rendered
  in the same panel, with the reference ranges labelled as reference ranges.

## Testing

TDD throughout: every generator's test is written before it, because a wrong
answer in a poker drill looks entirely plausible.

Generators take an injectable `rng`, so tests are deterministic and can loop
~200 deals per kind asserting invariants:

- The answer is always derived from `lib/poker` — never a hand-written constant.
  A test that hard-codes an expected out count is itself a bug.
- `options` contains `answer`, has no duplicate values, and its length agrees
  with `layout`: exactly 2 for `"two"`, 3 or 4 for `"grid3"`, exactly 4 for
  `"one"` (the single-column layout used by the long-text concept questions in
  `concepts` and `implied`'s concept mode).
- `outs`: the named draw and the out count agree with `DRAW_OUTS` in unknown
  mode (correctness rule 5), and a card that makes a hand living on the board
  alone is never counted (rule 3).
- `rule24`: estimates above 8 outs use `ruleOf4Corrected` (rule 4).
- Every money question obeys one betting convention: `pot` is the total after
  the villain's bet, `call` is what it costs (rule 1). A test asserts
  `requiredEquity` recomputed from the payload equals the question's answer.
- `payload` carries `level` and `oppMode`, and re-deriving the answer from the
  payload reproduces `answer`.
- `preflop`: `acceptable` contains every action at ≥20% frequency and `answer`
  is the most frequent one.
- `difficulty`: the ≥6-entry floor, and the 0.80 / 0.50 boundaries exactly.
- `grade`: correct / acceptable / wrong for a mixed preflop question.

Python side (pytest): the `skill_stats` upsert increments rather than
read-modify-writes, the tag map covers all nine kinds and nothing else, the
`drill-state` query shape, and `Literal` rejection of an unknown `drill_kind`.

Existing suites stay green throughout: `npm test` and
`.venv/bin/python -m pytest api/ -q`.

## Task sequence

Ordering is driven by what blocks the fan-out.

1. **Foundation** (alone, blocks everything): `contract.ts`, `grade.ts`,
   `difficulty.ts`, `rng.ts`, `registry.ts` skeleton. Tests for grade and
   difficulty. The contract is frozen at the end of this task.
2. **Player + tabs, and `outs` as the first kind** (parallel with 3):
   `DrillPlayer`, `DrillTabs`, `/drill` page, `/drill/outs` redirect, Opponent
   toggle, Difficulty tile — plus porting the existing `outsQuestion.ts` onto
   the contract as `kinds/outs.ts`, including its face-up branch. Doing one real
   kind here is what proves the renderer and the contract before eight agents
   commit to them.
3. **API** (parallel with 2): `api/skills.py`, `skill_stats` upsert,
   `GET /api/progress/drill-state`, `Literal` on `drill_kind`, client fetch that
   seeds the windows.
4. **The remaining eight generators** (fan-out, after 2): one agent per kind,
   each writing its test first, all eight ported from the reference HTML —
   `rule24`, `potodds`, `decision`, `implied`, `ev`, `bluff`, `concepts`,
   `preflop`. They touch disjoint files; `registry.ts` is the only shared file
   and each agent appends exactly one line to it.
5. **Reference tab.**
6. **Integration**: Mixed mode, difficulty seeding end-to-end, full suites, and
   a live production check on the deployed URL.
7. **Carryovers, last**: confirm-email decision (recommendation: leave it off
   until there is an SMTP story — an unverified-email signup that works beats a
   confirmation mail that lands in spam, and nothing in M2 trusts the address),
   then the Google OAuth provider, which is blocked on enabling MFA on the
   Google account before the Cloud console is reachable. Redirect URI is in
   `docs/04-roadmap.md`.

## Risks

- **The contract turns out not to fit a kind mid-fan-out.** Mitigated by
  building `outs` on it in task 2, before the other eight start; the reference's
  own renderer is already generic over all nine, which is strong evidence the
  shape holds. If a kind needs a block the union lacks, the block is added to
  `contract.ts` in one place and the affected agent is rebased.
- **Betting-convention drift across eight independently written generators.**
  Mitigated by the payload-recompute test being mandatory in every money
  generator's test file, and by every generator importing from `lib/poker/math`
  rather than doing arithmetic inline.
- **`drill-state` cost.** One indexed query on `attempts (user_id, created_at
  desc)`, which already exists. If it is slow on the free-plan 10s budget, the
  fallback is to drop it and start every session at level 1 — the drill works
  without it.
