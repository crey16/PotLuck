# PotLuck product roadmap

Updated 2026-08-03 after implementing and verifying M8. This document is the source
of truth for product sequencing. Detailed shipped-state records stay in the
milestone status documents; this roadmap distinguishes the finished foundation
from the remaining product goal.

## Product north star

PotLuck should provide close functional and interaction parity with **GTO
Wizard's Practice mode**, adapted to PotLuck's existing visual system. A player
configures the solution and positions, chooses a preflop/flop/custom starting
spot and action family, then trains at a positional poker table. Every supported
decision is graded from solver frequencies and EVs.

After a hand, the player receives a GTO score, a best-move/verdict summary,
preflop/flop/turn/river navigation, and a detailed node review with every
action's frequency and EV. They can repeat the hand, play again from a selected
node, or move to the next generated hand.

Here, **1:1 means parity with that Practice-mode workflow and information
hierarchy**. It does not mean heads-up-only poker or real-time multiplayer. The
screen may show a full six- or eight-seat table while training a two-position
spot, with uninvolved seats visually de-emphasized. PotLuck should not reuse GTO
Wizard branding or assets; the reference defines the behavior, table layout,
controls, and review flow.

Practice must not depend on a small static question bank. Numeric and card
questions should be generated from tested poker rules; solver practice should
sample from versioned solver data; and recent-question memory should survive a
reload so random selection does not immediately serve the same material again.

The major Industry-system redesign, rebrand, and redesign-v2 pass are complete.
The final product stage is a bounded list of minor UI fixes, responsive checks,
and accessibility polish—not another visual overhaul.

## Status key

- ✅ **Shipped:** implemented, verified, and released.
- 🟠 **Release pending:** implemented and verified locally against the real
  database/runtime shape, but not yet migrated or deployed to production.
- 🟡 **Foundation shipped:** useful implementation exists, but it does not yet
  meet the north-star definition above.
- ⬜ **Planned:** not implemented.

## Capability audit

| Product capability | Status | What exists now | What remains |
|---|---|---|---|
| GTO Wizard-style Practice setup | 🟡 | `/play` starts a solver hand immediately from one hard-coded spot. | Add the positional setup table, solution profile, preflop/flop/custom starting spot, preflop-action filters, advanced settings, and a validated Start Training flow. |
| Practice table interaction | 🟡 | `/play` deals full BTN-versus-BB single-raised-pot hands, shows cards/pot/actions, and supports both hero positions. | Match the reference's positional oval table and active/inactive seats; add configurable matchups and coherent branches instead of forcing unsupported preflop choices down the scripted raise/call line. |
| GTO rating on every street | 🟡 | Postflop choices use real solver frequencies and EV loss; flop, turn, and river decisions receive correct / also-fine / inaccuracy / blunder verdicts. | Preflop uses solver-shaped **reference ranges**, not solver EVs. It records no preflop EV loss and therefore is not yet an all-street GTO grade. |
| Per-hand review | 🟡 | M8 adds durable recent-session and recent-hand views plus a reloadable full review with every recorded decision, grading provenance, solve version, and all server-derived alternatives. The live completed-hand panel still shows its compact summary. | Add the EV-derived GTO score, street tabs, best-move summary, decision navigation, Repeat Hand, and Play From Here. |
| Weakness detection over time | 🟡 | M8 normalizes server-graded decisions by street, position, spot, board texture, hand class, action context, frequency, and EV loss. Unverified legacy grades are excluded from quality aggregates. | Build the recent/lifetime aggregates, taxonomy, confidence thresholds, trend analysis, weakness UI, and targeted routing in M11. |
| Guidance to the right practice | 🟡 | The deterministic recommendation engine selects the weakest skill tag and routes to an unfinished lesson or authored scenario. The Home page can link known math tags to drills. | Play weaknesses are not classified finely enough to target a drill or play spot. `postflop_play` has no direct drill mapping, and recommendations optimize raw accuracy rather than EV loss or trend. |
| Generated drill questions | 🟡 | Eight drill kinds generate cards or numeric parameters with seeded RNG and tested poker math. Preflop samples scenarios, grid cells, and actual suits. | The 15-item OMC concept drill and the six-item implied-odds concept mode are static banks. M4 practice uses 33 authored scenarios and 20 authored table scenarios. |
| Repeat avoidance | 🟡 | Generated drills use a 24-question per-kind signature window. `/play` uses a session-scoped used set while choosing from 5,000 offline-generated scripted instances. Authored scenarios exclude the five most recent IDs. | Drill and play repeat memory resets on reload; table scenarios have no recent-history exclusion; fixed concept banks must eventually cycle; solver hands are still a finite pre-scripted set. |
| Core visual design | ✅ | Industry design system, PotLuck rebrand, light/dark themes, dashboard/drill/social layouts, and the 2026-08-03 redesign-v2 pass are shipped. | M10 still adds the new Practice-mode surface because it is core product behavior. After that, only a final punch list, responsive audit, state coverage, and accessibility fixes remain. |

## Shipped foundation

### M1 — Live skeleton ✅ SHIPPED 2026-07-29

Authentication, one generated outs drill, FastAPI-on-Vercel, Supabase
persistence, XP/level/streak updates, and the live URL shipped. Email/password
is live; Google provider configuration remains an external setup item.

See `docs/05-m1-status.md`.

### M2 — Full math drill set ✅ SHIPPED 2026-07-29

Nine drill kinds plus Mixed mode, adaptive per-kind difficulty, face-up and
unknown-opponent modes, canonical skill tags, a generic renderer, and reference
content shipped.

See `docs/06-m2-status.md` and
`docs/superpowers/plans/2026-07-29-milestone-2-full-drill-set.md`.

### Redesign and rebrand ✅ SHIPPED 2026-07-30; V2 SHIPPED 2026-08-03

The frontend moved to the Industry design system and the product became
PotLuck. The dashboard, navigation, drills, ranges, lessons, social pages,
authentication, light/dark themes, and table surfaces share the same system.
The redesign-v2 pass and horizontal-overflow follow-up landed 2026-08-03.

### M3 — Range charts ✅ SHIPPED 2026-07-30

Eight 13×13 preflop reference scenarios, combo-aware range percentages, mixed
cells, explore mode, and preflop drilling shipped. These ranges are explicitly
labelled as references rather than solver output.

### M4 — Learning path ✅ SHIPPED 2026-07-30

Five modules, 20 lessons, authored practice and table scenarios, daily content,
server-authoritative grading, progress, and the first deterministic
recommendation loop shipped.

See `docs/07-m4-status.md`.

### M5 — Drill-variety foundation 🟡 SHIPPED 2026-07-30

Continuous parameter sampling, exact-card generation, deterministic seeds,
question signatures, and a session-scoped anti-repeat window shipped. This
solved repetition for the eight procedural drill kinds inside a session, but
the static concept banks and cross-session repeat memory remain for M9.

### M6 — GTO play foundation 🟡 SHIPPED 2026-07-31

`/play` ships a functional end-to-end prototype: 25 texture-diverse flops ×
200 scripted instances, a real postflop solver, GTO action mixes, EV-loss
verdicts, a street-by-street feed, hand review, and session statistics. It is
the technical foundation for the north star, not the finished GTO trainer:
preflop is reference-based, only BTN-versus-BB single-raised pots are covered,
and longitudinal weakness analytics are missing. M8 now implements durable
server-authoritative history and detailed reloadable review, pending its
production rollout. The prototype also lacks the
reference Practice flow's configuration screen, positional table, per-hand GTO
score, street navigator, detailed node review, and Play From Here control.

The offline solver remains the right production shape. Runtime solving does
not fit the deployment limits; future stages should publish compact, versioned
solver data and sample from it at runtime.

See `docs/08-m5-m6-status.md` and `docs/11-m8-status.md`.

### M7 — Core social ✅ SHIPPED 2026-08-03

Friends, live XP/streak leaderboards, authenticated profiles, profile editing,
the social RLS migration, and production release checks shipped. Challenges,
the activity feed, accuracy leaderboards, avatars, and anonymous profile cards
remain later social work, after the training loop below.

See `docs/09-m7-status.md`.

## Active execution order

### M8 — Durable play history and GTO telemetry ✅ SHIPPED 2026-08-03

**Goal:** create trustworthy, queryable records for a complete hand and every
decision before expanding the solver or building weakness analysis.

- [x] Write and approve a data-contract design for `play_sessions`,
  `play_hands`, and `play_decisions` (or an equivalent normalized model).
- [x] Add a new migration; never edit `0001_initial_schema.sql` in place.
- [x] Give every solve pack, hand, node, and decision a stable versioned ID so
  a historical result can always be interpreted against the data that graded
  it.
- [x] Record session/hand linkage, position, spot, stack depth, street, board
  texture, hand class, action context, chosen action, available actions, GTO
  frequencies, action EVs, EV loss in big blinds, verdict, and timestamp.
- [x] Store the practice configuration snapshot with each session: solution
  profile/version, table size, selected hero/matchup positions, starting spot,
  action-family filters, stack, rake/EV model, and advanced settings.
- [x] Keep `attempts` as the XP/streak event if useful, but make play history
  authoritative in the new model rather than reverse-engineering analytics
  from generic JSON payloads.
- [x] Validate or re-derive grading server-side from the referenced solve data;
  do not trust a client-supplied `is_correct`, frequency, or EV loss for the
  coaching record.
- [x] Add idempotency so a retry cannot duplicate a decision or hand.
- [x] Backfill the compatible parts of existing `play` attempts into a separate
  unverified archive namespace. Mark old preflop rows as reference-sourced and
  EV-unknown instead of inventing values or claiming authoritative grades.
- [x] Add authenticated APIs/queries for recent sessions, hands, and a complete
  hand review, with RLS tests proving users cannot read each other's history.
- [x] Preserve incomplete hands safely and distinguish abandoned from completed
  hands.
- [x] **Release gate (executed 2026-08-03):** applied
  `0004_m8_play_history.sql` to production, deployed the API and frontend, and
  audited the cutover — 0 unlinked legacy play attempts, so no delta archive
  was needed. Verified owner-only reads at both the API and policy layers, an
  interrupted reload and abandonment, a completed reload with every decision
  and alternative, idempotent retries earning no second XP, exactly one linked
  `attempts` row per decision, and legacy rows labelled unverified and excluded
  from EV/blunder totals. Rollout also fixed a packaging defect: the solve pack
  moved to `solver/pack/` because Vercel strips `public/` from the Python
  function bundle. See `docs/11-m8-status.md`.

**Done when:** a finished hand can be reopened after a reload and shows every
preflop/flop/turn/river decision that occurred, its grading source and solve
version, all alternatives, and EV loss in big blinds. Duplicate submits are
harmless, and another account cannot read it. **Met by the local integration
harness; production release is the remaining gate.** See
`docs/10-m8-play-data-contract.md` and `docs/11-m8-status.md`.

### M9 — Generated practice and persistent anti-repeat ⬜ PLANNED

**Goal:** make repeatable practice procedural and make recent-question memory
survive page reloads and new sessions.

- [ ] Add `question_signature`, `generator_version`, and reproducible seed/input
  metadata to every drill attempt.
- [ ] Seed each drill's recent-signature window from authenticated history
  before the first deal, without reintroducing server/client hydration drift.
- [ ] Persist recent play-instance or generated-hand signatures so `/play` does
  not start replaying yesterday's hands after a reload.
- [ ] Replace the 15-item OMC bank with rule-backed scenario templates that vary
  cards, stacks, pot sizes, action context, wording, and distractors while
  deriving the answer from canonical rules.
- [ ] Replace the six-item implied-odds concept bank with generated stack/pot/
  opponent situations. Keep reverse-implied-odds judgments constrained by
  explicit tested rules rather than free-form plausible text.
- [ ] Separate authored teaching material from repeatable practice: lessons may
  remain authored, but scenario and table-practice endpoints should serve
  parameterized/generated variants instead of relying on `order by random()`
  over 33 + 20 fixed rows.
- [ ] Spike a runtime sampler over versioned solver packs that deals legal hero
  and opponent combos, runouts, and opponent actions from solver frequencies.
  Retain generated instance packs only where the compressed policy data is too
  large, and apply persistent deduplication in either representation.
- [ ] Add property tests for legal cards, reproducibility, answer correctness,
  option validity, distribution coverage, and repeat distance for every
  generator.
- [ ] Add a deterministic replay/debug path from generator version + seed so a
  reported bad question can be reproduced exactly.

**Done when:** procedural drills have no repeated signature inside a 50-question
rolling window even across a reload; generated concept practice has enough
validated variation to meet the same guarantee; and a solver hand seen recently
is not immediately re-served in a new session. Every generated answer is
derived from tested math/rules or versioned solver output.

### M10 — GTO Wizard Practice-mode parity ⬜ PLANNED

**Goal:** replace the M6 prototype shell with the setup → train → score → review
→ repeat/play-from-here/next-hand workflow shown in the supplied GTO Wizard
Practice references. Preserve PotLuck's typography, colors, and components
while matching the reference's table structure, information hierarchy, and
interaction model closely.

#### M10A — Practice setup

- [ ] Add a dedicated setup state before training instead of immediately
  loading the hard-coded `srp-btn-bb` spot.
- [ ] Build the positional oval-table selector. Show the configured table size,
  let the player include one or more hero positions/matchups, identify the
  dealer, and visibly dim uninvolved seats.
- [ ] Add a solution-profile selector for the supported game type, table size,
  chip-EV/rake model, stack depth, and solve version. Display a concise summary
  with advanced settings available separately.
- [ ] Add **Starting spot** controls for Preflop, Flop, and Custom. A Custom
  start must still resolve to a validated supported solver node.
- [ ] Add **Preflop action** filters equivalent to Any, single-raised pot,
  3-bet, 4-bet, 5-bet, squeeze, limp, and isolation. Disable or clearly mark
  filters for which no compatible solve pack exists rather than faking them.
- [ ] Let the coaching engine deep-link into the same setup with a weakness-
  targeted configuration while keeping every setting visible and editable.
- [ ] Validate the complete configuration before enabling Start Training and
  show why an unsupported combination cannot start.

#### M10B — Positional training table

- [ ] Render the active hand on the same oval seat map used by setup: position,
  remaining stack in big blinds, dealer button, active player outline, hero
  cards, and opponent cards only when the training state permits them.
- [ ] Keep folded/uninvolved seats present but subdued so the positional context
  remains visible, as in the reference.
- [ ] Center the spot label, effective stack, pot, board, and current pot size;
  keep units in big blinds by default.
- [ ] Present only legal actions from the current solver node, with sizing in
  big blinds. Do not reveal frequencies or the best action before the player
  chooses.
- [ ] Make every chosen action advance through its real branch: folds terminate,
  calls/raises enter their matching nodes, and unsupported off-tree
  continuations are never silently substituted.
- [ ] Sample opponent mixed actions and runouts from the active solve version,
  including preflop, while keeping the complete hand reproducible.
- [ ] Support keyboard input, deliberate action confirmation where needed, and
  fast next-decision transitions without hiding table-state changes.

#### M10C — Score and hand summary

- [ ] Define and test a stable **GTO score** derived from EV loss, not pot
  outcome or binary accuracy. Store both the display score and its underlying
  EV-loss inputs/version.
- [ ] After a hand, show the GTO score and a clear best-move / acceptable /
  inaccuracy / blunder summary for the selected decision.
- [ ] Add Preflop, Flop, Turn, and River tabs. Mark streets containing decisions,
  disable streets never reached, and preserve the selected decision while
  moving between summary and detail.
- [ ] Add previous/next decision navigation within the hand.
- [ ] Add **Repeat Hand**, which restores the identical cards, runout, actions,
  solve version, and starting node without overwriting the original result.
- [ ] Add **Next Hand**, which respects the active setup and persistent
  anti-repeat rules.

#### M10D — Detailed node review and continuation

- [ ] For every reviewed decision, show each available action, its solver
  frequency, action EV or EV difference, the player's chosen action, and the
  solver-preferred/mixed actions.
- [ ] Add a strategy-frequency bar or equivalent compact visualization that
  makes pure and mixed nodes immediately readable without relying on color
  alone.
- [ ] Keep the board, cards, positions, stacks, pot, and action history visible
  while inspecting a node.
- [ ] Add **Play From Here**: fork a new unscored/replay hand from the selected
  historical node, preserve the original review, and record the fork lineage.
- [ ] Allow returning from node detail to the four-street hand summary without
  losing the current hand or decision selection.

#### M10E — Solver truth and coverage

- [ ] Produce versioned preflop solver data with action frequencies and EVs;
  retire reference-range grading inside `/play`.
- [ ] Grade preflop with the same EV-loss vocabulary used postflop and store its
  EV loss in big blinds.
- [ ] Show the exact solve assumptions—positions, table size, stack,
  blinds/antes, rake/EV model, open size, and available bet sizes—so “GTO” is
  never presented as universal.
- [ ] Add a spot catalog instead of hard-coding `srp-btn-bb`. Prioritize
  unopened preflop, blind defense, single-raised pots, and 3-bet pots before
  rarer action families.
- [ ] Add more board textures and legal sizes based on measured dataset size,
  browser load time, and solver validation—not an arbitrary file count.
- [ ] Validate every published solve pack for legal cards, reachable branches,
  probability normalization, action/EV coherence, and complete terminal paths.

**Done when:** a player can configure a supported practice spot, start at
preflop/flop/custom, make decisions on the positional table, receive an
EV-derived GTO score, move across street and decision reviews, inspect every
action's frequency/EV, repeat the same hand, play again from a reviewed node,
and deal the next non-recent hand. The full workflow works for at least 50
consecutive legal hands without being forced onto an incompatible branch, and
all results persist through reload.

### M11 — Longitudinal weakness analysis ⬜ PLANNED

**Goal:** diagnose leaks from decision quality rather than whether a hand won.

- [ ] Build deterministic aggregates from `play_decisions` for both recent and
  lifetime windows.
- [ ] Measure EV loss per decision and per 100 decisions, blunder rate, action-
  frequency deviation, and sample size. Keep raw “accuracy” secondary.
- [ ] Segment by street, position, pot type, stack depth, board texture, made
  hand/draw class, facing-action type, and decision family (for example bluff
  catch, value bet, c-bet, check-raise, and sizing).
- [ ] Define a versioned taxonomy shared by solve export, ingestion, analytics,
  and drill routing; do not infer categories later from display strings.
- [ ] Use minimum samples and confidence/shrinkage rules so three bad clicks do
  not become a declared weakness.
- [ ] Compare recent performance with the player's own baseline and show trend,
  not just a lifetime average.
- [ ] Build a history page with sessions, hands, filters, per-street summaries,
  and the evidence behind each identified leak.
- [ ] Exclude abandoned, invalid, superseded-solve, or unverifiable decisions
  from coaching aggregates while retaining them for audit/debugging.

**Done when:** after enough play, PotLuck can explain a specific weakness such
as “turn bluff-catching from out of position” with sample size, EV cost,
blunder rate, time window, trend, and links to the hands that support it.

### M12 — Adaptive coaching and drill routing ⬜ PLANNED

**Goal:** turn a credible weakness into the next best piece of practice and
verify whether it improves.

- [ ] Create an explicit, tested mapping from weakness taxonomy to generated
  drills, lessons, authored explanations, and targeted GTO spots.
- [ ] Add missing practice for poker decisions that cannot be repaired by the
  existing nine math drills (for example c-bet selection, bluff catching,
  turn barreling, river value/bluff balance, and bet sizing).
- [ ] Build one recommendation service used by Home, Learn, Drill, and Play;
  retire duplicated weakest-tag selection logic.
- [ ] Rank recommendations using EV cost, confidence, recency, prerequisite
  knowledge, and recent exposure. Do not simply select the lowest all-time
  correct percentage.
- [ ] Explain every recommendation in player language: what the leak is, the
  evidence for it, why this exercise addresses it, and what improvement will
  count as success.
- [ ] Create a focused practice queue that mixes targeted work with spaced
  review and some broad coverage, rather than repeating only the weakest tag.
- [ ] Carry the weakness context into the destination so “Practice this” opens
  the correct drill kind, level, lesson, or solver spot.
- [ ] Re-evaluate after a defined sample and show whether EV loss/blunder rate
  improved; avoid changing the target after every answer.

**Done when:** a qualified leak produces an explainable recommendation that
opens matching practice, gathers a new sample, and reports whether the relevant
GTO decision metric improved.

### M13 — Reliability, security, and release hardening ⬜ PLANNED

- [ ] Rate-limit authenticated write endpoints and add idempotency coverage for
  decision ingestion.
- [ ] Fail safely on missing/corrupt solve assets and solve-version mismatches;
  never grade against a different version than the one displayed.
- [ ] Add load/performance budgets for solve manifests, first hand, next hand,
  history queries, and weakness reports.
- [ ] Run all TypeScript and Python suites, type checking, lint, production
  build, solver-pack validation, and multi-account RLS checks.
- [ ] Confirm `SUPABASE_SERVICE_ROLE_KEY` appears in no client bundle.
- [ ] Verify RLS is enabled for every user-scoped table and private profiles do
  not leak through search, leaderboards, history, or recommendations.
- [ ] Verify streak boundaries in `America/New_York`, `/api/health` cold-start
  behavior, retry handling, and production observability.
- [ ] Apply new migrations and solver packs in a reversible release order, then
  perform authenticated production walkthroughs with two accounts.

**Done when:** the complete training loop is production-verified, private by
default, observable, retry-safe, and within agreed performance budgets.

### M14 — Final minor UI fixes ⬜ PLANNED — DO LAST

The design direction is settled. This stage is a finite punch list after the
training behavior and data contracts stop moving. Building the GTO Wizard-style
setup/table/review workflow belongs to M10; this stage only polishes that
finished workflow and the rest of the existing product.

- [ ] Add the user's concrete UI punch-list items here as individual checkboxes
  and treat that list as the source of truth for this stage.
- [ ] Polish the table's action hierarchy, board/street readability, review
  scanning, history filters, and recommendation handoff without changing the
  underlying workflows.
- [ ] Audit every route at desktop and real 390px mobile width, especially
  `/play`, hand history, weakness reports, and the 13×13 range grid.
- [ ] Finish loading, empty, offline, permission, and error states; use
  skeletons only where they make waiting clearer.
- [ ] Check keyboard-only use, visible focus, screen-reader labels, contrast,
  reduced motion, target sizes, and non-color verdict cues.
- [ ] Check long names/content, zoom, light/dark themes, supported browsers, and
  horizontal overflow.
- [ ] Add focused visual/regression coverage for the final high-risk layouts.

**Done when:** every recorded punch-list item is closed, the core flows pass the
responsive/accessibility audit, and no new design system or broad restyle was
introduced.

## Later backlog, not on the critical training path

- M7.5 social: challenges, meaningful activity feed, accuracy/EV leaderboards,
  avatars, and optional public/anonymous profile metadata.
- Google OAuth provider setup after the Google account's MFA prerequisite; make
  a separate confirm-email/SMTP decision.
- More solver configurations after M10's starter configuration is coherent and
  measured: additional positions, stack depths, rake structures, bet sizes,
  and tournament formats.
- External hand-history import and tracker integration.
- Free-form solver browsing or runtime solving.
- Payments and native mobile.

## Roadmap maintenance rule

Update this document at the end of every milestone task. Check a box only after
its implementation and relevant verification are complete; add the completion
date and link a status record when a milestone ships. If implementation changes
an architectural assumption, update the affected future stages in the same
change so the roadmap does not retain stale instructions.
