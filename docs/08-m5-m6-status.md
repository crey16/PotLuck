# M5 + M6 status — drill variety and the play mode

Shipped together on 2026-07-30. M5 kills question repetition in the nine
multiple-choice drills; M6 adds `/play`, a GTO-Wizard-style practice mode
playing full hands against real solver output.

## M5 — Drill variety

**Problem:** questions repeated because each generator sampled from tiny
hardcoded tables (pot odds L1: 5 pots × 3 fractions) and the two concept
banks re-drew freely.

**What shipped**

- `sampleInt` / `sampleStepped` (`lib/drill/opts.ts`) and `dealPotRangeSpot`
  (`lib/drill/money.ts`): potodds, ev, bluff, decision and implied now sample
  pots / bet fractions / equities from per-level continuous ranges. Level
  semantics preserved — L1 stays clean numbers, and the bluff size drill
  still snaps a displayed 33%/67% to the exact third (finding L-13).
- Anti-repeat (`lib/drill/antirepeat.ts`): every `DrillQuestion` now carries a
  `signature` — what makes it "the same question" to a player, coarser than
  the payload (concepts: bank id; preflop: scenario|hand; spot drills: exact
  cards). `generateFresh` re-rolls collisions against a 24-deep per-kind
  window by continuing the same seeded rng stream, so deals stay
  deterministic in (seed, dealCount, window). DrillShell records signatures
  at answer time; the SSR first deal always runs with an empty window so
  hydration cannot drift.
- Tests: `lib/drill/variety.test.ts` simulates sessions per kind × level ×
  seed — zero repeats inside the window for all eight generated drills, grid
  sweep for preflop, clean-number invariants at L1. The 15-item concepts bank
  necessarily cycles instead: its first 15 questions are all distinct.

## M6 — Play mode (`/play`)

**The architecture that made it fit.** A full postflop strategy-tree export
measured 739 MB gzipped PER FLOP (1.1M decision nodes × ~700 combos) — dead
on arrival. The play mode instead pre-generates **scripted hand instances**:
hero hand + bot hand sampled from the solved ranges, then the tree of HERO
choices only — bot responses sampled from its solver strategy, runout cards
sampled per branch, hero's action frequencies + EV losses stored for hero's
specific hand. ~200 bytes gzipped per playable hand; the full 25-flop set is
~10 MB of static JSON in `public/solves/srp-btn-bb/`.

**Offline pipeline** (`solver/`, never deployed):

- `potluck-solver` (Rust, `postflop-solver` crate — AGPL, offline tool only,
  bincode feature disabled since it no longer compiles): solves BTN-open
  2.5bb / BB-call, 100bb, on a simplified tree (flop 33% / turn 66% / river
  66%, one 2.5x raise size, all-in by threshold) to <0.3% pot
  exploitability, ~1–3 min per flop on the M4 Pro; then exports 200
  instances per flop (~40 KB gz).
- Ranges come FROM the app: `solver/gen-ranges.ts` derives the two range
  strings from `lib/poker/ranges.ts` (BTN open = scenario `btn`, BB flat =
  scenario `bb-btn` call), so `/play`, `/ranges` and the preflop drill can
  never disagree.
- `solver/flops.txt` — 25 texture-diverse flops. `run-all.sh` solves them
  all; `publish.sh` writes `public/solves/srp-btn-bb/` + manifest;
  `validate.ts` exhaustively re-walks every hero path of every instance
  through the app's own timeline machine; `simulate-session.ts` plays full
  random sessions as the "done when" check.
- EV semantics learned the hard way: per-action EVs must come from
  `expected_values_detail` AT the node (CFR's own comparison values) — 
  descending into children and calling `expected_values` mixes incompatible
  normalization references and produces garbage. All-in showdowns terminate
  the solver tree without chance nodes, so the exporter deals the remaining
  runout itself. At rarely-reached nodes CFR EVs are noisy, so an action the
  solver plays ≥78% has its loss clamped into the correct band.

**App side:**

- `lib/play/` — pure, tested: `types` (data contract), `timeline` (the hand
  state machine: instance + chosen actions → ordered events), `actions`
  (code parsing/labels), `verdict` (EV-loss grading: correct ≤0.1bb /
  acceptable = mixed ≥20% and ≤0.5bb / inaccuracy <0.75bb / blunder),
  `preflop` (the entry decision graded against the reference ranges),
  `load` (manifest fetch + uniform no-repeat instance picker).
- `components/play/PlayShell.tsx` + `app/play/page.tsx` + a Play nav entry:
  felt with face-down bot (revealed at showdown via `whoIsAhead`), action
  feed, per-decision verdict with the full GTO mix + EV losses + equity,
  end-of-hand review, session stats (hands, decisions, accuracy, EV lost,
  blunders), keyboard driving throughout.
- Persistence: new attempt kind `play` — `ATTEMPT_KINDS = DRILL_KINDS +
  "play"` in `lib/drill/contract.ts`, the `AttemptIn` literal, and
  `api/skills.py` (skill tag `postflop_play`), pinned three ways by
  `test_drill_kinds_match_typescript.py`. One attempt per decision through
  the existing XP/streak pipeline; verified 200 OK against the live API.

## Verification record

- 265 TS tests + 67 pytest green; `tsc`, lint (0 errors) and `next build`
  clean.
- `solver/validate.ts`: every hero path of every instance of every published
  flop walks clean (no dangling nodes, 5-card showdowns, no duplicate cards,
  freq/EV coherence).
- Browser walkthrough on the dev server: preflop → flop → turn barrel →
  bot fold, correct pot math (+$48 on a $151 pot), verdicts and GTO mixes
  rendering, attempt writes 200.

## Traps for whoever touches this next

- The solver crate is archived; build it with `default-features = false`
  (the bincode save/load feature no longer compiles) and pin nothing else.
- Solve outputs are NOT reproducible bit-for-bit across runs (thread
  scheduling); regenerate a whole flop, never hand-edit published JSON.
- `/solves/*.json` sits behind the auth middleware like every route — the
  client fetch sends cookies; anonymous fetches 307 to /login.
- The play mode's $ figures are chips at $10 blinds; EV-loss steps are
  0.05bb (`EV_STEP_BB`). If you change `ev_unit` in the exporter, change
  `lib/play/verdict.ts` in the same commit.
