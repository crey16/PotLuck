# HCWK Wizard

Poker training web app — Duolingo-style lessons, GTO-style range charts, exact
math drills, and the social layer that makes it worth coming back to.

Merges **StackSchool** (FastAPI + Expo, in `~/PycharmProjects/PokerDuolingo`,
untouched) with a standalone poker math trainer.

**Start here: [`CLAUDE.md`](./CLAUDE.md)** — stack decisions, correctness rules,
and what is already built.

## What is in this folder right now

This is a handoff package, not a running app yet. The Next.js scaffold is
milestone 1 (see `docs/04-roadmap.md`).

```
CLAUDE.md                              project context — read first
docs/01-architecture.md                stack, hosting, auth flow, constraints
docs/02-migration-from-stackschool.md  what ports, what changes, what dies
docs/03-api-surface.md                 all 30 existing endpoints + new ones
docs/04-roadmap.md                     milestones, starting with a live URL
supabase/migrations/0001_initial_schema.sql   full schema + RLS
lib/poker/engine.ts                    hand evaluator, equity, outs   (tested)
lib/poker/math.ts                      pot odds, EV, MDF, implied odds (tested)
lib/poker/ranges.ts                    8 preflop scenarios, grid       (tested)
lib/poker/engine.test.ts               14 tests — all passing
reference/poker-math-trainer.html      the working trainer, as a spec
.env.example                           every variable you need
```

## Verify the engine

```bash
npm i -D tsx typescript @types/node
npx tsx --test lib/poker/engine.test.ts
```

Expect `# pass 14`. Those tests encode bugs that were found and fixed — a
failure means the engine is wrong, not the test.

## Stack

Next.js (App Router) + FastAPI, both on Vercel. Supabase for Postgres, Auth and
Realtime. See `docs/01-architecture.md` for why, and for the Vercel Python
runtime limits worth designing around.
