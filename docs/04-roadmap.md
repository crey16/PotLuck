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
  arrives. Revisit in M5, when public profiles and challenges give a reason to
  care who owns an address.

## Redesign + rebrand ✅ SHIPPED 2026-07-30 (unplanned, between M2 and M3)

The whole frontend moved to the "Industry" blueprint design system (from
`HCWK Wizard Redesign.html`): Barlow/Barlow Condensed, light default + dark
remap, sticky header with Home / Drill / Ranges / Reference / System nav, a
real home dashboard (level hero, skill-strength bars, drill cards, 12-week XP
heatmap), the drill switcher + session rail, standalone `/ranges`, `/reference`
and `/system` pages, and the split-hero auth page. The app rebranded to
**PotLuck**: repo `crey16/PotLuck`, folder `~/PycharmProjects/PotLuck`,
production https://potluck-poker.vercel.app (old URL 307-redirects).

**Note for M4:** the redesign spec contains no lesson screens. The learning
path needs its own design pass in the same system before implementation.

## M3 — Range charts ✅ SHIPPED (with the redesign)

- ✅ 13×13 grid from `lib/poker/ranges.ts`, 8 scenarios, mixed cells rendered
  as split fills, computed range percentages shown.
- ✅ Explore mode (`/ranges`) and drill mode (the M2 preflop drill).
- ✅ Labelled as reference ranges, not solver output — the warning box sits
  beside the page title.

## M4 — The learning path ← NEXT (not started)

**This is the Duolingo half of the product and none of it exists yet.** The
app currently drills and documents; it does not teach. Everything below is
pending.

Port lessons, modules, scenarios and table scenarios from StackSchool. Seed the
content from `backend/seed.py` (~1,700 lines: 5 modules — Foundations through
bankroll discipline — with dozens of lessons built from info/quiz/drill/recap
screens, plus scenarios and table scenarios). Bring across `/progress`
(lesson-complete), `/scenarios`, `/table-scenarios`, `/daily`,
`/recommendations`, `/stats`.

What exists already: the DB tables (`modules`, `lessons`, `scenarios`,
`table_scenarios`, `progress`, `daily_content`, `user_daily_completions`) are
in `0001_initial_schema.sql` with RLS, empty. `skill_stats` already pools
drill and lesson accuracy on shared tags, and the home dashboard already
surfaces the weakest skill — the recommendation hook is waiting for lessons
to point at.

What has to be built:
1. **Content seed** — port `seed.py` into a Supabase seed (UUID user keys,
   `lesson_type` enum).
2. **API routes** — lesson list/complete (XP + streak + daily activity),
   scenario random/submit, daily, recommendations, stats.
3. **UI (needs design first — absent from the redesign spec):** a learn
   path/module map on Home or `/learn`, `/learn/[module]` detail, and a
   lesson player for the four screen types (info / quiz / drill / recap) with
   XP award and progress. The Expo screens (ModuleDetail, LessonPlayer) are
   the behavioural spec.
4. **Recommendations surfaced** — "what should I do next" on Home, driven by
   the existing deterministic rule (weakest tag ≥5 attempts → uncompleted
   lesson for it → else scenario at matched difficulty → else first
   Foundations lesson).
5. **Daily content** — the `/daily` loop that gives the streak something to
   bite on beyond raw drilling.

This is the biggest chunk of straight porting. It was deliberately sequenced
after the drills because the drills are what make the app worth opening.

## M5 — Social

1. **Friends** — port the four endpoints; search by username, never email.
2. **Leaderboards** — global and friends, by XP / streak / accuracy. Subscribe
   via Supabase Realtime so it moves while you watch.
3. **Public profiles** — `/u/[username]`, skill breakdown, streak heatmap,
   respecting `is_public`. Add OG tags so shared links preview well.
4. **Challenges** — freeze N hands, both players answer the same set, compare.
   Start with friend-to-friend and a 7-day expiry.
5. **Activity feed** — meaningful events only.

## M6 — Polish (partly absorbed by the redesign)

- [x] Keyboard shortcuts — 1–4 to answer, N/Enter next, R reference, D mixed.
- [x] Light/dark themes (token remap, cookie-persisted, no flash).
- [~] Mobile-responsive layout — grids and answer lists collapse, but no
  device pass has been done; the 13×13 grid under 560px needs a real check.
- [ ] Empty states audit, loading skeletons, error boundaries.
- [ ] Rate limiting on write endpoints.

## Deliberately not in v1

- Postflop solver browsing. Real solving is a different class of problem and not
  replicable client-side.
- Hand history import / tracker integration.
- Payments.
- Native mobile. The Expo app still works against the same API; revisit later.

## Sanity checks before sharing widely

- [ ] `SUPABASE_SERVICE_ROLE_KEY` appears in no client bundle (`grep` the build output)
- [ ] RLS is on for every table (`select * from pg_tables where rowsecurity = false`)
- [ ] A second test account cannot read the first account's attempts
- [ ] `is_public = false` genuinely hides a profile from search and leaderboard
- [ ] Cold start on `/api/health` is acceptable
- [ ] Streak rolls over at midnight **America/New_York**, not UTC
- [ ] `npx tsx --test lib/poker/*.test.ts` passes
