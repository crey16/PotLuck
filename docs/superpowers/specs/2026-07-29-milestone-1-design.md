# HCWK Wizard — Milestone 1 design + implementation plan

## Context

HCWK Wizard merges StackSchool (FastAPI + Expo, `~/PycharmProjects/PokerDuolingo`,
**read-only**) and a standalone HTML poker-math trainer into one web app on
Vercel (Next.js App Router + FastAPI Python Function) with Supabase
(Postgres/Auth/Realtime). `lib/poker/` is written and tested (14/14, verified
this session via `npx tsx --test lib/poker/engine.test.ts`);
`supabase/migrations/0001_initial_schema.sql` is validated. No `package.json`
exists yet — the Next.js scaffold is greenfield around `lib/`, `docs/`,
`supabase/`, `reference/`, `.venv/`, `.idea/`.

**M1 done-when:** send a friend a link → they sign up with Google → complete one
outs drill → their XP persists (visible after reload).

## Decisions made in brainstorming (all approved by user)

1. **Drill UI:** faithful port of `reference/poker-math-trainer.html` — its CSS
   custom-property tokens go into `globals.css` nearly verbatim; same stat
   tiles, felt, option buttons, feedback panel. No new visual design in M1.
2. **StackSchool carryover:** none visually in M1. It contributes logic rules
   (XP formula, streak rule, upsert pattern) now; lesson content waits for M4.
3. **Auth:** Google **and** email+password from the start. Email is the
   test-account path (two-account RLS checks, E2E without OAuth).
4. **Page surface:** `/login`, `/drill/outs`, `/` redirects into the drill.
   Slim persistent header with username / XP / level / streak from `profiles`.
5. **Write path:** FastAPI owns it. `POST /api/progress/attempts` verifies the
   JWT, then in one transaction: insert `attempts` row (with `drill_kind`,
   `drill_payload`), award XP, recompute level, update streak, upsert daily
   activity; returns the updated profile. This deliberately forces M1 to prove
   the Python function, JWKS verification, and the pooler connection.
6. **XP rule for drills:** 10 XP per correct answer, 0 for incorrect
   (tunable). `level = xp // 100 + 1` in ONE consolidated helper.

## Architecture (M1 slice)

### Auth key matrix
| Consumer | Client | Credential | RLS |
|---|---|---|---|
| Browser | `createBrowserClient` (@supabase/ssr) | `NEXT_PUBLIC_SUPABASE_URL` + anon key, session in cookies | enforced |
| Server components + middleware | `createServerClient` + cookie adapters | anon key + user JWT from cookies | enforced |
| FastAPI | `psycopg` over pooler DSN (**port 6543**) | `DATABASE_URL`; identity = `sub` from JWT verified against Supabase JWKS (`PyJWKClient`, aud `authenticated`); NEVER a user id from the request body | bypassed — every query scoped by verified `sub` |

**No `SUPABASE_SERVICE_ROLE_KEY` in any M1 runtime** (FastAPI speaks Postgres
directly, not Supabase REST). Keep it in `.env.example` for later milestones.

### /api routing
- `api/index.py` exports FastAPI instance named `app`; routes declared WITH the
  `/api` prefix (`/api/health`, `/api/progress/attempts`) so dev == prod paths.
- Prod: Vercel routes `/api/*` to the function natively. If detection is flaky,
  pin `tool.vercel.entrypoint = "api/index.py"` in a minimal `pyproject.toml`.
- Dev: dev-only rewrite in `next.config.ts` of `/api/:path*` →
  `http://127.0.0.1:8000/api/:path*`; `npm run api` starts uvicorn;
  `npm run dev:all` runs both (concurrently).
- **Collision rule: nothing ever goes in `app/api/`.** Auth callback lives at
  `app/auth/callback/route.ts`.

### Middleware
Only two jobs: refresh the session cookie — writing it back to BOTH the request
and the response (skipping that = "logged out on refresh") — and redirect
unauthenticated users to `/login`. Protect `/` and `/drill/*`.

## Order of operations (user dashboard work vs code)

| # | Who | What |
|---|---|---|
| 1 | User — Supabase | Create project; capture URL, anon key, service key, DB password, region |
| 2 | User — Supabase | Run `0001_initial_schema.sql` in SQL editor; confirm `on_auth_user_created` trigger exists |
| 3 | User — Google Cloud | OAuth consent + client; redirect URI `https://<ref>.supabase.co/auth/v1/callback`; paste ID/secret into Supabase → Auth → Providers → Google |
| 4–7 | Code | Tasks 1–6 below (local dev fully working: Next on 3000, uvicorn on 8000) |
| 8 | User — GitHub/Vercel | Create GitHub repo, push, import to Vercel, set env vars per `.env.example` |
| 9 | User — Supabase | Set Auth Site URL to the Vercel URL + allowlist redirect URLs (Google works locally but breaks in prod without this) |
| 10 | Both | Verification checklist |

Steps 1–3 must be done before Task 3 (auth wiring) needs `.env.local`.
Tasks 1–2 don't need credentials and can start immediately.

## Implementation tasks (sequential; fresh subagent per task; TDD inside each)

**Task 1 — Scaffold.** Run `create-next-app` (TS, App Router, Tailwind v4,
ESLint) in the scratchpad; copy into repo root WITHOUT overwriting any existing
path: `app/`, `public/`, `package.json`, `tsconfig.json`, `next.config.ts`,
`postcss.config.mjs`, `globals.css`. Merge `.gitignore` (union). Edit
`package.json`: add `"test": "tsx --test lib/poker/*.test.ts"`, devDeps `tsx`,
`concurrently`. `tsconfig` paths `@/*` → root so `@/lib/poker/engine` resolves.
Untouched: `lib/`, `docs/`, `supabase/`, `reference/`, `CLAUDE.md`,
`.env.example`, `.venv/`, `.idea/`, `_to_delete/` (user deletes that one).
**Verify:** `npm test` → 14/14; `npm run dev` serves the default page.

**Task 2 — Design tokens + UI primitives.** Port the reference `<style>` block
(lines 8–181 of `reference/poker-math-trainer.html`) into `globals.css` /
Tailwind theme: `--plane/--surface/--ink/--good/--crit/...`, dark default +
light values. Components: `PlayingCard` (46×64, red/4-color variants),
`StatTile` (+ meter/pips), `Felt`, `OptionButton` (key hint, correct/wrong
states), `FeedbackPanel` (ok/no bar + worked-math rows + note), `Header`.
Test: a render test for `PlayingCard` mapping `Card` int → rank/suit glyph and
color class (uses `cardStr`/`SUIT_GLYPH` from the engine).

**Task 3 — Auth.** `lib/supabase/client.ts` (browser), `lib/supabase/server.ts`
(server components), `middleware.ts` (cookie refresh + write-back to request AND
response + redirect-to-login), `app/login/page.tsx` (Google button +
email/password form, styled with Task 2 tokens), `app/auth/callback/route.ts`
(code exchange). `.env.local` from user's step 1–3 values.
**Verify:** sign up with email locally → `profiles` row auto-created by trigger;
session survives hard reload; Google sign-in works on localhost.

**Task 4 — /drill/outs page.** Client component. `dealDrawSpot()` (street
random flop/turn, level 2 default), question "How many outs do you have?",
choices = correct count + distractors built like the reference (`Q.outs`,
~line 601 of the HTML), keyboard 1–4 to answer + N/Enter for next. Feedback:
correct/incorrect bar, worked rows (draw label, outs count, hit probability via
`hitProbability`), outs breakdown via `describeOuts`. Header shows profile
stats (server-fetched). Local session stats (score/accuracy/streak-of-answers)
in-page like the reference tiles.
Test: option-set generation (distractors never include the answer twice, always
contains the truth), deterministic with an injected `Rng`.

**Task 5 — FastAPI.** `api/index.py` (+`api/requirements.txt`: fastapi, pyjwt,
cryptography, psycopg[binary,pool]). Endpoints: `GET /api/health` (+`?db=1` →
`SELECT 1` through the pool — separates "function up" from "DB reachable");
`POST /api/progress/attempts` — verify JWT per `docs/01-architecture.md`
sketch → single transaction: insert attempt, `xp += 10 if is_correct`,
`level = xp // 100 + 1` (one helper), streak rule (yesterday → +1, today → no
change, else → 1) with `zoneinfo.ZoneInfo("America/New_York")` day boundaries,
`user_daily_activity` upsert `ON CONFLICT DO UPDATE` (never read-modify-write).
Returns updated profile JSON.
**TDD (pytest, pure units first):** streak transitions incl. the NY-midnight
edge (e.g. 11:30pm ET vs 00:30am ET next day, and UTC dates that differ from NY
dates), XP/level helper, JWT dep rejects bad/missing tokens. DB-touching path
verified against the dev Supabase project via the pooler DSN.
Reference for behaviour: StackSchool `routes/progress.py::_update_streak`,
`activity.py` (read-only).

**Task 6 — Wire drill → API.** On answer: POST to `/api/progress/attempts` with
`Authorization: Bearer <access_token>` (from the browser Supabase session) and
body `{drill_kind: "outs", drill_payload: <frozen Spot>, answer, is_correct}`.
Update header stats from the response (no refetch). Failures are non-blocking
for the drill loop (toast/quiet retry — the drill must never feel dead).
**Verify:** answer locally → row in `attempts`, XP/level/streak move in
`profiles`, header updates, values survive reload.

**Task 7 — Deploy + verification (user + code).** User does steps 8–9 above.
Then the checklist:
- `curl` prod `/api/health` (404 → entrypoint problem; pin pyproject) and
  `/api/health?db=1` (fail → DSN problem: must be pooler host, port 6543, user
  `postgres.<ref>`); time cold vs warm start.
- Fresh incognito → Google signup from the prod URL → drill → answer → reload →
  XP persisted. (OAuth error after consent → step 9 allowlist.)
- Session survives reload in prod (fail → middleware cookie write-back).
- Two-account RLS check: account B cannot read A's attempts.
- `grep` the build output: service-role key appears in no client bundle.
- `npm test` still 14/14.
Use systematic-debugging (not guess-and-check) on any failure; the three
expected trouble spots are @supabase/ssr cookies, the pooler string, and cold
starts.

**Task 8 — Finish.** `finishing-a-development-branch` once green and deployed.

## Process agreements (from user)

- Subagent-driven development: fresh subagent per task, two-stage
  spec-then-quality review; `requesting-code-review` between tasks.
- TDD inside every task; it matters most for poker math, XP/streak (NY timezone
  trap), and RLS.
- M1 is sequential — no forced parallelism (dispatching-parallel-agents waits
  for M2's 10 drills / M4's route groups).
- Never touch `~/PycharmProjects/PokerDuolingo`; never edit
  `0001_initial_schema.sql` in place; keep `lib/poker` tests green after any
  `lib/poker` change.
- First implementation step: write this approved design as a spec to
  `docs/superpowers/specs/2026-07-29-milestone-1-design.md` and commit it
  (deferred from brainstorming because plan mode restricts writes to this file).

## Verification (end-to-end definition of done)

A friend opens the Vercel URL, signs up with Google, completes one outs drill,
sees XP in the header, reloads, and the XP is still there — plus the Task 7
checklist all passing.
