# PotLuck — project context

Read this first. It is the handoff from the planning session that produced this
folder. Nothing here is aspirational: the decisions below are settled, and the
code that already exists is tested.

## What this is

A poker training web app — Duolingo-style lessons plus GTO-Wizard-style range
charts and math drills — with friends, leaderboards, head-to-head challenges and
an activity feed. Built to be deployed and shared with friends.

It merges two existing things:

1. **StackSchool** (`~/PycharmProjects/PokerDuolingo`) — a working FastAPI +
   Expo React Native app: 15 tables, 30 endpoints, JWT auth, lessons/scenarios/
   progress/streaks/friends. **Do not modify that folder.** It is the reference
   implementation and stays intact.
2. **A poker math trainer** (`reference/poker-math-trainer.html`) — a
   self-contained HTML app with an exact hand evaluator and 10 drill modules.
   Its engine is already ported to TypeScript in `lib/poker/`.

## Settled decisions

| Decision | Choice | Why |
|---|---|---|
| Hosting | **Everything on Vercel** | Vercel added first-class FastAPI support (docs updated 2026-07). One repo, one `git push`, Next.js frontend + Python API as a Vercel Function. |
| Database | **Supabase Postgres** | Managed, has a serverless connection pooler, and gives Realtime + RLS. |
| Auth | **Supabase Auth** (replaces the JWT system) | Free Google/Apple sign-in, magic links, hosted password reset. Removes the biggest friction for friends signing up. |
| Backend language | **Keep Python/FastAPI** | 2,584 lines of working, tested logic. Port, don't rewrite. |
| Frontend | **Fresh Next.js (App Router) web UI** | Range grids and charts need real screen space. The Expo app's *logic* ports; its layouts do not. |
| Sequencing | **Deployable skeleton first** | Auth + DB + one drill on a live Vercel URL before porting the rest. |

## Repo shape to build toward

```
/                        Next.js app (App Router) — deployed to Vercel
  app/                   routes, server components
  components/            UI
  lib/
    poker/               ✅ ALREADY WRITTEN AND TESTED — engine, math, ranges
    supabase/            client/server helpers
  api/                   FastAPI app (Vercel Python Function)
    index.py             must export a FastAPI instance named `app`
  supabase/
    migrations/          ✅ 0001_initial_schema.sql written
  docs/                  ✅ architecture, migration, API surface, roadmap
  reference/             ✅ the original trainer HTML, for behaviour reference
```

Vercel finds the Python entrypoint automatically at `api/index.py` (or set
`tool.vercel.entrypoint` in `pyproject.toml`). Route the frontend to it with a
rewrite of `/api/:path*` in `next.config.js`.

## What is already done (do not redo)

- **`lib/poker/engine.ts`** — card model, 5/6/7-card evaluator, exact equity by
  full runout enumeration, outs vs a known hand, draw outs with no villain, dead
  out detection, draw classification, spot generation.
- **`lib/poker/math.ts`** — pot odds, EV, break-even bluff, MDF, implied odds,
  rule of 2 & 4 with the >8-outs correction.
- **`lib/poker/ranges.ts`** — 8 preflop scenarios as threshold specs, 13×13 grid
  helpers, combo-accurate range percentages.
- **`lib/poker/engine.test.ts`** — 14 tests, all passing. Run them:
  `npx tsx --test lib/poker/engine.test.ts`
- **`supabase/migrations/0001_initial_schema.sql`** — full schema with RLS.

## Poker-math correctness rules

These were learned the hard way. Violating them produces confidently wrong
numbers that look plausible.

1. **One betting convention, everywhere.** `pot` = total pot AFTER villain's bet
   (what you win). `call` = what it costs you. Functions taking `potBefore` say
   so in the name. Mixing these is the #1 source of wrong answers.
2. **Never hand-code out counts.** Always derive them from the evaluator. A
   hand-written "flush draw = 9 outs" is wrong whenever a board-pairing card
   gives villain a full house.
3. **A hand that lives on the board alone is nobody's out.** Four to a flush or
   four to a straight on the board means the fifth card is shared. `drawOuts`
   already checks this; keep the check if you refactor.
4. **The ×4 rule overstates above 8 outs.** It double-counts runouts that hit on
   both cards. 15 outs is 54%, not 60%. Use `ruleOf4Corrected`.
5. **Label and count must agree.** In the beginner drill mode, a spot is only
   dealt if the named draw has exactly the out count `DRAW_OUTS` says it should.
   Never show "open-ended straight draw" next to an answer of 4.
6. **Preflop ranges are approximations and must be labelled as such in the UI.**
   They are solver-shaped reference ranges, not solver output.

## Product rules carried over from StackSchool

- **XP → level:** `level = (xp / 100) + 1`. Denormalised on the profile row.
- **Streaks:** incremented when the user is active on a new day; reset to 1 if a
  day was skipped. Day boundaries are **America/New_York**, not UTC — see
  `backend/app/activity.py` in StackSchool.
- **Daily activity** is an upsert with `ON CONFLICT DO UPDATE` so it is safe to
  call multiple times per request.
- **Recommendations** are deterministic and rule-based, not AI: find the weakest
  skill tag with ≥5 attempts, serve an uncompleted lesson for it, else a scenario
  at a difficulty matched to accuracy (<40% → 1, <75% → 2, else 3).
- **Friends** are stored bidirectionally — two rows per friendship.

## Working agreements

- **Never touch `~/PycharmProjects/PokerDuolingo`.** Read it for reference only.
- **No AI commit attribution.** Keep the configured human Git author and never
  add `Co-authored-by`, `Signed-off-by`, or similar attribution trailers for
  Claude, Codex, Anthropic, OpenAI, or any other AI/tool to commit messages.
- Run `npx tsx --test lib/poker/*.test.ts` after any change to `lib/poker`. Those
  tests encode real bugs that were found and fixed; if one fails, the engine is
  wrong, not the test.
- Secrets go in `.env.local` (git-ignored). `SUPABASE_SERVICE_ROLE_KEY` must
  never reach the browser — server-side only.
- RLS is on for every user-scoped table. If a query returns nothing unexpectedly,
  suspect a missing policy before suspecting the query.
- Vercel Python constraints to design around: **no WebSockets**, 10s function
  timeout on the free plan (60s on Pro), 300–800ms cold starts, no background
  workers. Use **Supabase Realtime from the browser** for live leaderboards and
  feeds, and **pg_cron** for scheduled work.

## Skill pipeline (superpowers)

This project is built with the `superpowers` skill set installed. The intended
flow, and where each skill earns its keep here:

| Skill | Where it applies |
|---|---|
| `brainstorming` | Before each milestone. Design gets accepted before code exists. |
| `subagent-driven-development` | Implementation — fresh subagent per task, two-stage review. |
| `test-driven-development` | Anything touching poker math, XP/streak rules, or RLS policies. These are the places a wrong answer looks completely plausible. |
| `dispatching-parallel-agents` | M2's 10 drill modules and M4's API route groups are independent — real fan-out. M1 is sequential; don't force it. |
| `requesting-code-review` / `receiving-code-review` | Between tasks. |
| `systematic-debugging` | Deploy and RLS problems, where guess-and-check wastes hours. |
| `finishing-a-development-branch` | End of each milestone, once tests pass and the deploy is green. |

The 14 tests in `lib/poker/engine.test.ts` are the regression suite for the whole
project. Run them after any change to `lib/poker`, and keep them green.

## Current state (updated 2026-07-30)

**M1 is shipped and live at https://hcwk-wizard.vercel.app.** Email signup,
the outs drill, and XP/streak persistence are verified in production. Secrets
and a working test account live in git-ignored `.env.local`. `main` on
`crey16/PotLuck` auto-deploys to Vercel.

**M2 is code-complete on branch `m2-full-drill-set`, not yet merged or
deployed.** All nine drills behind one generic renderer, a Mixed mode, a
Reference tab, per-drill adaptive difficulty seeded from history, both opponent
modes, and `skill_stats` per skill tag. 183 TS + 28 pytest green; 18/18 live API
checks against the real Supabase project. **One verification is outstanding: an
authenticated visual pass over the eleven tabs — nothing has been seen rendering
in a browser yet.** Google OAuth and the confirm-email decision are still open.

Read `docs/06-m2-status.md` before touching M2 code — it carries the settled
decisions M3 inherits and three local-dev traps that each cost real time
(`python-dotenv` missing from `api/requirements.txt`, `PyJWKClient` needing
`SSL_CERT_FILE` or every request 401s, and the dev `/api` proxy port now being
`API_PORT` because a collision on 8000 silently routes into another service).
Then `docs/05-m1-status.md` for M1.

### M2 rules that are easy to break
- Relative imports under `lib/` carry **no** file extension — Turbopack does not
  rewrite `.js`→`.ts` for value imports and the build fails.
- **No `setState` inside `useEffect`** (lint error). Derive during render,
  initialise lazily, set from event handlers, or reset a child with `key`.
  Anything the server must agree with comes down as a prop.
- Annotate conditionally-built arrays (`ExplainNote[]`, `ViewBlock[]`) or the
  first element's literal type narrows the array and later pushes won't compile.
- `GENERATORS` in `lib/drill/registry.ts` is a **total** `Record`: adding a
  `DrillKind` without a generator is a compile error, by design.

## Getting oriented

Read in this order: `docs/01-architecture.md` → `docs/02-migration-from-stackschool.md`
→ `docs/03-api-surface.md` → `docs/04-roadmap.md` → `docs/05-m1-status.md`.
