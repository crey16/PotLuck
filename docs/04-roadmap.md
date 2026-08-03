# Roadmap

Sequenced so there is a real, shareable URL as early as possible. Deployment
problems are the ones that eat days; surface them in milestone 1, not at the end.

## M1 — Skeleton on a live URL ✅ SHIPPED 2026-07-29

**Live at https://potluck-poker.vercel.app** — email+password signup, the outs
drill, and XP/streak persistence all verified against production (12/12 live
checks: trigger-created profiles, XP through the FastAPI function, RLS
two-account isolation, ET streak dates). See `docs/05-m1-status.md` for the
full state, infrastructure references, and deploy learnings.

**One deliberate deferral:** Google sign-in. The button ships but the provider
is unconfigured — Google Cloud console access is blocked until MFA is enabled
on the Google account. Moved to the top of M2 (below). Original done-when
otherwise met, with email signup standing in for Google.

**Done when (original):** you can send a friend a link, they sign up with Google, do one
outs drill, and their XP persists.

1. `npx create-next-app@latest` (App Router, TypeScript, Tailwind) at the repo root.
2. Copy `lib/poker/` in. Wire the test script into `package.json`. Confirm 14/14 pass.
3. Create the Supabase project. Run `supabase/migrations/0001_initial_schema.sql`.
   Verify the `on_auth_user_created` trigger creates a profile row on signup.
4. Supabase Auth with `@supabase/ssr`: `/login`, middleware-protected routes,
   email + Google provider.
5. One page — `/drill/outs` — using `dealDrawSpot()` and `drawOuts()`. Answer,
   feedback, next hand. Port the look from `reference/poker-math-trainer.html`.
6. `POST /api/progress/attempts` as the first FastAPI route on Vercel. Prove the
   Python function deploys and can reach Supabase through the **pooler** string.
7. Deploy. Check cold-start latency and that auth survives a full page reload.

**Watch for:** the pooler connection string (port 6543, not 5432); the service
role key must be a Vercel env var, never in client code; `@supabase/ssr` cookie
handling in middleware is the usual source of "logged out on refresh".

## M2 — The full drill set ✅ SHIPPED (merged to `main`, live in production)

**Built and verified.** All nine drills, a Mixed mode, a generic renderer, a
Reference tab, per-drill adaptive difficulty seeded from history, both opponent
modes, and `skill_stats` per canonical skill tag. 183 TS + 28 pytest green,
`tsc`/lint/build clean, and 18/18 live API checks against the real Supabase
project. See `docs/06-m2-status.md` for the full state, the settled decisions M3
inherits, and the local-dev traps.

- ✅ Counting outs · Rule of 2 & 4 · Pot odds · Call or fold · Implied odds ·
  Expected value · Bluff math · OMC mistakes · Preflop drill
- ✅ Adaptive difficulty from a rolling window of the last 10 — **per drill
  kind**, not global, and restored on load with `levelFromHistory`.
- ✅ Two opponent modes: unknown (draw outs) and face-up (outs vs a known hand,
  with dead outs named). Default unknown, persisted in a cookie so the
  server-rendered first hand already respects it.
- ✅ Every answer records an `attempts` row with `drill_kind` + `drill_payload`.
- ✅ `skill_stats` updated per canonical skill tag (`api/skills.py`), five tags
  reused from StackSchool so drill and lesson accuracy pool.
- ✅ Reference cheat-sheet tab, every figure computed from `lib/poker/math.ts`
  so it can never disagree with the drills.

- [x] **Authenticated visual pass over all eleven tabs.** Done. Found six real
  defects — including `/drill` throwing on every request, and seeded difficulty
  never reaching the first hand — all fixed with regression tests. Full
  accounting in `docs/06-m2-status.md`.

**Still carried over (now genuinely last):**
- [ ] **Google OAuth provider.** Prereq: enable MFA on the Google account, then
  Google Cloud console → OAuth consent screen + Web client with redirect URI
  `https://ajaryvyorhwnhinzubqd.supabase.co/auth/v1/callback` → paste client
  ID/secret into Supabase → Auth → Providers → Google. The app-side button
  already works.
- [ ] **Confirm-email decision.** Recommendation: **leave it off** until there is
  an SMTP story. Nothing in the app trusts the address; Supabase's default sender
  is rate-limited and lands in spam often enough to lose a friend at the signup
  step, and an unverified signup that works beats a confirmation mail that never
  arrives. Revisit in M7 (Social), when public profiles and challenges give a
  reason to care who owns an address.

## Redesign + rebrand ✅ SHIPPED 2026-07-30 (unplanned, between M2 and M3)

The whole frontend moved to the "Industry" blueprint design system (from
`HCWK Wizard Redesign.html`): Barlow/Barlow Condensed, light default + dark
remap, sticky header with Home / Drill / Ranges / Reference / System nav, a
real home dashboard (level hero, skill-strength bars, drill cards, 12-week XP
heatmap), the drill switcher + session rail, standalone `/ranges`, `/reference`
and `/system` pages, and the split-hero auth page. The app rebranded to
**PotLuck**: repo `crey16/PotLuck`, folder `~/PycharmProjects/PotLuck`,
production https://potluck-poker.vercel.app (old URL 307-redirects).

**M4 follow-through:** the redesign spec contained no lesson screens, so M4
received its own approved Industry-system design at
`docs/superpowers/specs/2026-07-30-milestone-4-learning-path-design.md` before
implementation.

## M3 — Range charts ✅ SHIPPED (with the redesign)

- ✅ 13×13 grid from `lib/poker/ranges.ts`, 8 scenarios, mixed cells rendered
  as split fills, computed range percentages shown.
- ✅ Explore mode (`/ranges`) and drill mode (the M2 preflop drill).
- ✅ Labelled as reference ranges, not solver output — the warning box sits
  beside the page title.

## M4 — The learning path ✅ SHIPPED 2026-07-30

The complete learning loop is live at **https://potluck-poker.vercel.app**.
Production has the lesson-attempt migration and the complete stable content
seed; authenticated API, RLS, desktop, and true 390 px browser walkthroughs all
passed. See `docs/07-m4-status.md` for the architecture, content corrections,
release fixes, and verification record.

- [x] **Content seed:** 5 modules, 20 lessons, 33 authored scenarios, and 20
  table scenarios with explicit stable IDs and non-destructive upserts.
- [x] **API:** content/progress, server-graded lesson attempts, server-derived
  completion scores, scenario and table-scenario grading, deterministic
  recommendations, deterministic ET daily content, guarded/idempotent daily
  bonus, skill stats, and activity stats.
- [x] **Industry-system design:** approved local spec at
  `docs/superpowers/specs/2026-07-30-milestone-4-learning-path-design.md`.
- [x] **UI:** `/learn`, module detail, four-screen lesson player,
  `/learn/practice`, `/learn/table`, and `/daily`, plus Learn navigation and a
  next recommendation on Home.
- [x] **Missing-content fallback:** a weak skill with no matching lesson or
  scenario falls through to the next real item instead of a dead link.
- [x] **Release migration:** apply `0002_lesson_screen_attempts.sql` to the
  production database.
- [x] **Release content:** apply `supabase/seed.sql` after the migration.
- [x] **Ship and verify:** deploy, run the authenticated lesson/scenario/table/
  daily walkthrough, verify first-completion and replay XP against production,
  and repeat the two-account RLS check before marking M4 shipped.

## M5 — Drill variety (kill the repeats) ✅ SHIPPED 2026-07-30

**Why:** drill questions repeat within a session. They are already generated
algorithmically (seeded RNG, nine generators), but each generator samples from
a tiny hardcoded table — pot odds level 1 is 5 pot sizes × 3 bet fractions
(15 combos), preflop is 8 fixed scenarios. Decision: fix this **algorithmically**
— widen the parameter space and add anti-repeat memory. Not AI-generated:
questions stay deterministic, engine-verified, and free, per the correctness
rules in `CLAUDE.md` (no hand-authored numbers, no plausible-but-wrong math).

- [x] **Continuous sampling.** `sampleInt` / `sampleStepped` in
  `lib/drill/opts.ts` and `dealPotRangeSpot` in `lib/drill/money.ts`; potodds,
  ev, bluff, decision and implied now sample pots/fractions/equities from
  per-level ranges. Level semantics preserved (L1 stays clean numbers; the
  bluff size drill still snaps a displayed 33%/67% to the exact third,
  finding L-13).
- [x] **Anti-repeat memory.** `lib/drill/antirepeat.ts`: every question carries
  a `signature` (what makes it "the same question" to a player — coarser than
  the payload), `generateFresh` re-rolls collisions against a 24-deep per-kind
  window by continuing the same seeded rng stream (deals stay deterministic),
  and DrillShell records signatures at answer time so the SSR first deal is
  untouched. Session-level; seeding from `attempts` rows deferred until it
  proves needed.
- [x] **Preflop coverage.** Signature is `scenario|hand`, so the window forces
  the drill across the 13×13 grid instead of re-serving the same borderline
  hands; the existing pure-fold re-roll stays.
- [x] **Tests:** `lib/drill/variety.test.ts` simulates real sessions per kind ×
  level × seed and asserts zero repeats inside the window, grid sweep for
  preflop, and clean-number invariants for L1. Plus unit tests for the
  helpers. 249 TS + 65 pytest green, build clean.
- Skipped as not worth it now: prompt-wording template variants (pure surface
  variety; revisit if generated spots still feel samey in play).

**Done when:** a 50-question session in any single drill kind shows no repeated
spot. **Met** for the eight generated drills (verified in variety.test.ts).
The OMC-mistakes drill has a fixed 15-item bank, so its guarantee is the
strongest possible: the bank fully cycles before anything repeats.

## M6 — Play mode (GTO Wizard-style hand play) ✅ SHIPPED 2026-07-31

**Live at `/play`:** full BTN-vs-BB single-raised-pot hands against real
solver output, street by street, graded per decision by EV loss (correct /
also-fine / inaccuracy / blunder), with GTO mixes + equity shown after every
choice, end-of-hand review, showdowns settled by the app's own evaluator,
and session stats. See `docs/08-m5-m6-status.md` for the full architecture,
the verification record, and the traps.

- [x] **Solver pipeline (offline, `solver/`).** Rust exporter on the
  `postflop-solver` crate (AGPL, never deployed): BTN open 2.5bb / BB call,
  100bb, simplified tree (33/66/66% bets, one 2.5x raise size), solved to
  <0.3% pot exploitability per flop. **The sizing spike redirected the whole
  design:** a full strategy-tree export measured 739 MB gzipped PER FLOP, so
  the pipeline instead pre-generates **scripted hand instances** — hero hand
  + bot hand sampled from the solved ranges, hero's full choice tree with
  bot responses sampled from its strategy — at ~200 bytes gz per playable
  hand. 25 texture-diverse flops × 200 instances = 5,000 playable hands in
  ~10 MB of static JSON (`public/solves/srp-btn-bb/`); no Supabase needed.
- [x] **Data + grading.** Ranges derive FROM `lib/poker/ranges.ts`
  (`solver/gen-ranges.ts`), so /play, /ranges and the preflop drill agree.
  Grading is client-side from the shipped per-hand freq/EV-loss data
  (`lib/play/verdict.ts`), consistent with how the nine drills grade; the
  planned server-side grading was unnecessary once the data model became
  per-instance.
- [x] **Play UI.** `components/play/PlayShell.tsx` + `app/play/page.tsx` +
  nav entry: felt with face-down bot (revealed at showdown), action feed,
  keyboard-driven, Industry design system throughout.
- [x] **Preflop integration.** Every hand starts with the hero's own preflop
  decision, graded against the reference ranges; the hand then continues
  down the solved line with a note when the pick left it.
- [x] **Persistence.** One attempt per decision, new kind `play` (skill tag
  `postflop_play`), pinned across TS/pydantic/skills by the parity tests.
- [ ] **Expand coverage** (later): 3-bet pots, more position pairs, more
  flops, paced bot-action animations.

**Done when:** you can play 20 consecutive full hands in the starter spot with
per-decision solver grading and a session accuracy summary. **Met and
exceeded** — `solver/validate.ts` walks all 129,855 hero decision paths in
the shipped data with zero problems, `solver/simulate-session.ts` plays 20-
and 50-hand sessions clean, and the flow is browser-verified end-to-end
(both hero positions, attempt writes 200).

## M7 — Core social ✅ SHIPPED 2026-08-03

Scope settled in `docs/superpowers/specs/2026-08-03-milestone-7-core-social-design.md`:
friends + leaderboards + public profiles now; challenges and the activity
feed moved to M7.5. Architecture is hybrid — writes and friend-request
logic in FastAPI (`api/friends.py`, `api/profile.py`); RLS-secured reads
direct from Supabase, isolated in `lib/social/queries.ts`.

- [x] **Friends** — `/friends`: username search (relationship-aware
  buttons, never email), request/accept/decline/cancel with StackSchool's
  auto-accept-on-reverse-request, roster, unfriend (both rows + request
  corpse cleaned so re-friending works).
- [x] **Leaderboards** — `/leaderboard`: global (top 100, `leaderboard`
  view) and friends (direct `profiles` read, so private friends still
  rank among friends), XP and streak metrics, live via Realtime
  `postgres_changes` on `profiles` with a mover flash. A caller absent
  from the global board gets an unranked self row ("outside the top 100"
  or "private — not ranked publicly").
- [x] **Public profiles** — `/u/[username]` (logged-in only, by decision):
  identity plate, skill bars + 12-week streak heatmap for self/friends
  (RLS-gated; others see a "visible to friends" plate), private
  non-friend profiles 404 without confirming existence.
- [x] **Profile editing** — display name, bio, `is_public` toggle on your
  own profile. Avatar upload deferred.
- [x] Migration `0003_social_policies.sql` — status CHECK
  (`pending|accepted|declined`), cancel/unfriend DELETE policies,
  `profiles` added to the Realtime publication.
- [x] **Released 2026-08-03:** `0003` applied to production (constraint,
  policies, and Realtime publication verified in the catalog), deployed via
  `main`, and the production API verified with the test account (friends/
  requests/search round-trips, no email in search, PATCH profile
  set-and-revert, guard 404s). Remaining manual check: a second-account
  browser pass on the live site (accept/decline/unfriend and watching the
  board move) — the same flows are covered by the test suites.

Deferred to **M7.5**: challenges (freeze N hands, friend-to-friend, 7-day
expiry), activity feed (meaningful events only), accuracy leaderboard
metric, OG tags / anonymous profile pages, avatar upload.

## M8 — Polish (partly absorbed by the redesign)

- [x] Keyboard shortcuts — 1–4 to answer, N/Enter next, R reference, D mixed.
- [x] Light/dark themes (token remap, cookie-persisted, no flash).
- [~] Mobile-responsive layout — M4, Home, and the authenticated header pass a
  true 390 px device audit; the 13×13 range grid still needs its own real-device
  check.
- [ ] Empty states audit, loading skeletons, error boundaries.
- [ ] Rate limiting on write endpoints.

## Deliberately not in v1

- ~~Postflop solver browsing.~~ **Reversed 2026-07-30:** the M6 play mode uses
  real solver data via offline **precomputed** solutions. Runtime solving and
  free-form solver *browsing* remain out of scope — production only reads
  precomputed strategy trees.
- Hand history import / tracker integration.
- Payments.
- Native mobile. The Expo app still works against the same API; revisit later.

## Sanity checks before sharing widely

- [ ] `SUPABASE_SERVICE_ROLE_KEY` appears in no client bundle (`grep` the build output)
- [ ] RLS is on for every table (`select * from pg_tables where rowsecurity = false`)
- [x] A second authenticated user cannot read the first account's attempts
- [ ] `is_public = false` genuinely hides a profile from search and leaderboard
- [ ] Cold start on `/api/health` is acceptable
- [ ] Streak rolls over at midnight **America/New_York**, not UTC
- [x] The full `npm test` TypeScript suite passes (226/226 at M4 release)
