# M2 status — the full drill set

Read this before starting M3. It records what exists, what was verified and
how, and the traps found along the way. Nothing here is aspirational.

**State: code-complete and verified on branch `m2-full-drill-set`. Not yet
merged, not yet deployed.** One verification is deliberately outstanding — see
[Outstanding](#outstanding).

## What a user can do that they could not before

Open `/drill` and get a tabbed trainer: a Mixed drill plus nine individual
drills — counting outs, rule of 2 & 4, pot odds, call or fold, implied odds,
expected value, bluff math, OMC mistakes, and preflop ranges — plus a written
Reference tab. Difficulty adapts per drill from that drill's own last ten
answers and survives a reload. A face-up opponent mode shows the villain's hand
and strips dead outs. Every answer records an `attempts` row and updates
`skill_stats` under a canonical skill tag.

## Architecture

Each drill is a **pure function** `(ctx: DrillContext) => DrillQuestion` in
`lib/drill/kinds/`, returning data only — no React, no HTML. One
`components/drill/DrillPlayer.tsx` renders any `DrillQuestion` by mapping its
`ViewBlock`s onto the M1 UI components. One `lib/drill/grade.ts` decides
right/also-fine/wrong for all nine kinds.

That split is why the nine drills could be written by eight independent agents
in parallel and why the poker math is unit-testable without a DOM.

| Piece | Where |
|---|---|
| Frozen contract | `lib/drill/contract.ts` |
| The only grader | `lib/drill/grade.ts` (`gradeAnswer`, `isRight`) |
| Difficulty rules | `lib/drill/difficulty.ts` (`nextLevel`, `pushResult`, `levelFromHistory`, `mergeSeededWindows`) |
| Shared generator helpers | `lib/drill/opts.ts` (`buildOpts`, `intOptsInRange`, `money`, `pct`, …) |
| Seeded PRNG | `lib/drill/rng.ts` (`mulberry32`) |
| Nine generators | `lib/drill/kinds/*.ts`, one `.test.ts` each |
| Shared test invariants | `lib/drill/kinds/assertions.ts` — including the money-pill reconciliation that catches displayed numbers drifting from the payload |
| Shared money dealer | `lib/drill/money.ts` (`dealPotSpot`, `betSizePill`) |
| Shared drill prose | `lib/drill/notes.ts` (`deadOutsNote`, `drawLine`) |
| TS↔Python drift guard | `api/test_drill_kinds_match_typescript.py` |
| Registry / tabs | `lib/drill/registry.ts` — `GENERATORS` is a **total** `Record`, so a tenth kind without a generator is a compile error |
| Cross-kind suite | `lib/drill/registry.test.ts` |
| Skill-tag map | `api/skills.py` — server-side only |

## Settled decisions M3 inherits

1. **Difficulty is per drill kind, not global.** Nine independent rolling
   windows of ten. Being sharp at pot odds must not hand you level-3 outs hands.
2. **Difficulty is seeded from history** by `GET /api/progress/drill-state`, and
   restored with `levelFromHistory`, which replays `nextLevel` over growing
   prefixes. A single `nextLevel` call moves one step at most, so it could never
   restore a level the user climbed to over several answers.
3. **Seeding is first-paint restoration, not ongoing sync, and it merges per
   kind.** A kind already answered this session keeps its local window — the
   server snapshot predates that answer, so applying it there would roll the
   answer back while Score and XP still showed it. The merge is per kind
   (`mergeSeededWindows`) rather than all-or-nothing, because the first hand is
   always instantly answerable while the fetch waits on a session lookup, a
   Python cold start and a JWKS fetch; a blanket guard let one quick answer pin
   all nine drills to level 1 for the session. Seeding also re-deals once if
   nothing has been answered yet, so restored difficulty applies to the hand on
   screen rather than the next one.
4. **Restoring from a ten-entry window can demote by one step.**
   `levelFromHistory` replays from level 1 over the stored ten, while the live
   path continues from the current level. A level-3 user whose last ten are
   `TTTTTFFFFF` stays at 3 live (exactly 0.50 does not demote) but restores as
   2. That is inherent to reconstructing from a bounded window — it is a
   known trade-off, not a bug.
5. **Opponent mode lives in a cookie**, not `localStorage`, because the dealt
   spot depends on it and the page is server-rendered. `localStorage` is
   invisible during SSR, so a face-up user was served an unknown-mode *first*
   hand on every load.
6. **Every hand is reproducible from `(seed, dealCount)`.** The server supplies
   one seed per page load; the client derives each hand from
   `mulberry32(seed + dealCount)`. This removed all SSR/hydration mismatch and
   the mount effect — and it is what M3's "freeze N hands" challenges need.
7. **XP stays flat at 10 per correct answer**, computed only in `api/index.py`.
   The drill's session Score (`10 × difficulty + streak bonus`) is display-only
   and never persisted, so difficulty cannot be farmed once leaderboards land.
8. **`acceptable` is data, not a predicate.** Preflop uses it for mixed
   strategies (every action the scenario takes at ≥20%), and one concepts bank
   item uses it where a second option states the same conclusion in different
   words. Being data means M3 can re-grade server-side from `drill_payload`.
9. **Client-reported `is_correct` is still trusted.** Unchanged from M1.
   Re-grade server-side when leaderboards make XP competitive — `drill_payload`
   already carries everything needed. Note one shape change: M1 wrote the bare
   `Spot` at the payload root; M2 nests it under `spot` alongside
   `level`/`oppMode`. A re-grader distinguishes them with `"spot" in payload`.
   Existing rows were not migrated.

## Skill tags

`drill_kind → skill_tag` lives only in `api/skills.py`; the browser sends
`drill_kind` and never a tag. Five reuse StackSchool's vocabulary so drill and
lesson accuracy pool into one `skill_stats` row:

| kinds | tag |
|---|---|
| `potodds`, `decision` | `pot_odds` (a call/fold question *is* a pot-odds question) |
| `bluff` | `bluffing` |
| `concepts` | `discipline` |
| `preflop` | `hand_selection` |
| `outs` | `counting_outs` *(new)* |
| `rule24` | `equity_estimation` *(new)* |
| `implied` | `implied_odds` *(new)* |
| `ev` | `expected_value` *(new)* |

**M4 must tolerate a weakest tag with no lesson behind it** — the four new tags
have no lesson content yet.

## Verification

- **187 TypeScript tests + 32 pytest**, `tsc` clean, `npm run lint` 0 errors
  (one pre-existing warning in `lib/poker/engine.test.ts`), `npm run build`
  compiles.
- **`lib/drill/registry.test.ts`** walks all nine kinds × 3 levels × 2 opponent
  modes × seeds asserting the shared contract: exactly one option grades
  correct, option arity matches layout, payloads carry `level`/`oppMode` and are
  JSON-clean, `pickMixedKind` reaches all nine, and every emitted `ViewBlock`
  type is one the renderer handles.
- **Live API verification, 18/18 against the real Supabase project:** 10 XP for
  a correct answer and 0 for a wrong one, `level == xp//100 + 1`, `drill-state`
  returns nine windows, the newest window entry is **last** (oldest-first, as
  `pushResult` assumes) confirmed with real rows, 401 on both endpoints without
  a token, and 422 for an unknown `drill_kind` or an over-long `answer`.
- **`skill_stats` verified in Postgres:** `potodds` + `decision` attempts sum
  into the shared `pot_odds` row.
- Each generator was additionally probed directly against `lib/poker/math.ts` —
  e.g. rule24's big draws cite `ruleOf4Corrected` (15 outs: rule says 60%,
  corrected 53%, truth 54.1%); bluff satisfies
  `breakEvenFoldRate + minDefenceFrequency == 1`; potodds' raise spots price
  *better* than treating your own committed money as a cost.

## Outstanding

**The authenticated visual pass has not been done.** `/drill` is
middleware-protected (verified: 307 → `/login?next=…`), and completing sign-in
requires typing a password, which the assistant is not permitted to do. Every
drill is verified mathematically and the production build compiles, but nobody
has yet *seen* the felt render, the 13×13 grid draw, or the keyboard advance a
hand. **Do this before merging.** Sign in at `/login`, then walk all eleven
tabs, checking: the question renders with no missing block, the feedback numbers
agree with the question, `N` deals the next hand, the Difficulty tile moves
after six answers on one tab, and flipping Opponent to face-up shows the villain
plus a dead-outs note.

Also outstanding: **Google OAuth** (still blocked on enabling MFA on the Google
account) and the **confirm-email decision** — see `docs/04-roadmap.md`.

## Local development traps

Three separate things stop the app running locally. All cost real time; none is
visible from the code.

1. **`npm run api` needs `python-dotenv`.** It was missing from
   `api/requirements.txt` since M1, so uvicorn aborted with
   `ModuleNotFoundError` before binding a port. Fixed.
2. **`api/deps.py` 401s everything locally without a CA bundle.**
   `PyJWKClient` fetches JWKS over `urllib`, which on macOS may have no root
   certificates, giving `CERTIFICATE_VERIFY_FAILED`. `curl` works, so this looks
   exactly like an auth bug — and `deps.py` deliberately collapses every failure
   to a bare 401 with no detail. Fix:
   `export SSL_CERT_FILE=$(.venv/bin/python -c "import certifi; print(certifi.where())")`.
   Production is unaffected.
3. **The dev API proxy port is `API_PORT`** (default 8000). If another local
   service holds 8000, the dev rewrite in `next.config.ts` silently routes this
   app's `/api` calls into that service — which is how a poker drill ends up
   talking to somebody else's API and failing in ways that make no sense. Both
   sides read the same variable, so one value moves them together:
   `API_PORT=8011 npm run dev:all`.

## Process notes worth carrying forward

- **A test that never runs looks exactly like a passing test.** A bare directory
  argument in the `npm test` glob discovered nothing, because Node 20 only
  auto-discovers `*.test.{js,mjs,cjs}` — never `.ts`. The `lib/drill/kinds/`
  suites would have reported green while executing zero tests. The acceptance
  check that caught it was requiring the pass **count to rise**, not the suite
  to be green.
- **Turbopack does not rewrite `.js` → `.ts` for value imports.** M1 appeared to
  prove the `.js` extension convention safe; its one such import was type-only
  and erased before bundling. Relative imports now carry no extension.
- **`const notes = [{ tone: "plain", … }]` narrows the array's element type**, so
  every later `push` of a `"warn"` note fails to compile. Annotate as
  `ExplainNote[]`.
- Reference-porting slips found by review: the concepts bank has **15** items,
  not 16, and one item's correct answer sits at index **2** while the other
  fourteen are at 0 — with two near-identical options, so assuming index 0 marks
  the right answer wrong and looks fine doing it.
