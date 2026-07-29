# Kickoff prompt

Paste the block below as your first message in a Claude Code session opened at
`~/PycharmProjects/HCWKWizard`.

It is written for the **superpowers** skill set you have installed, and drives
the intended pipeline: `brainstorming` → plan → `subagent-driven-development`
(with `test-driven-development` inside each task) → `requesting-code-review` →
`finishing-a-development-branch`.

**Before you paste it:** the folder is not a git repo yet. Several of these
skills assume git (worktrees, branch finishing). Run this first:

```bash
cd ~/PycharmProjects/HCWKWizard
git init && git add -A && git commit -m "Handoff: context docs, poker engine, Supabase schema"
```

---

I'm building **HCWK Wizard**: a poker training web app that merges an existing
mobile app with a standalone HTML trainer into one deployable site I can share
with friends. Think GTO Wizard's range charts crossed with Duolingo's lessons
and streaks, plus a social layer.

**Start with the `brainstorming` skill.** I want to design this with you before
any code exists. Don't skip to implementation.

## Read first

This folder is a handoff package from a planning session. Read in this order:

1. `CLAUDE.md` — settled stack decisions, poker-math correctness rules, working agreements
2. `docs/01-architecture.md` — hosting shape, auth flow, Vercel Python limits
3. `docs/02-migration-from-stackschool.md` — what ports from the old app, what dies
4. `docs/03-api-surface.md` — all 30 existing endpoints, annotated keep/change/drop
5. `docs/04-roadmap.md` — 6 milestones

Also skim `reference/poker-math-trainer.html` — it's a working app and the
behavioural spec for the drills.

Then confirm the environment:
`npm i -D tsx typescript @types/node && npx tsx --test lib/poker/engine.test.ts`
Expect `# pass 14`. If any fail, stop and tell me before going further.

## Hard constraints

- **Never modify `~/PycharmProjects/PokerDuolingo`.** That's the existing FastAPI
  + Expo app. Read it freely as reference; it stays untouched.
- `lib/poker/` is already written and tested. Those 14 tests encode real bugs
  that were found and fixed — treat them as the regression suite for everything
  downstream. If you believe the engine is wrong, show me a failing test first.
- `supabase/migrations/0001_initial_schema.sql` is validated (77 statements, RLS
  on all 17 tables). Extend with new migration files; don't edit it in place.
- Stack is settled: Next.js App Router + FastAPI, both on Vercel; Supabase for
  Postgres/Auth/Realtime. Don't re-litigate unless something genuinely blocks us.

## What I want from this session

Brainstorm and design **Milestone 1** with me. It's done when I can send a friend
a link, they sign up with Google, complete one outs drill, and their XP persists.

Ask me whatever you need first. I especially want your questions on:

- how closely the drill UI should match `reference/poker-math-trainer.html`
  versus being redesigned for the web
- how much of the old app's lesson content and visual language to carry over
- whether to ship milestone 1 with email+password only, or wire Google from the start

Then present the design in sections I can accept or push back on, covering:

- the exact order of operations, and what I do by hand in the Supabase and Vercel
  dashboards versus what you do in code
- how the Next.js scaffold gets created *around* the existing `lib/`, `docs/`,
  `supabase/` and `reference/` folders without clobbering them — note that
  `.venv/` and `.idea/` are also present from PyCharm
- the `next.config.js` rewrite and layout that makes `/api/*` hit the FastAPI
  function, and where `api/index.py` lives
- how the browser, server components, and FastAPI each authenticate to Supabase
  differently, and which key each one uses
- what could realistically go wrong on first deploy, and how we'd detect it

## How I'd like the work to run after we agree a design

- Write the plan to a file so we can both work from it.
- Use `subagent-driven-development` for implementation — a fresh subagent per
  task, with the two-stage spec-then-quality review.
- Use `test-driven-development` inside each task. It matters most for anything
  touching poker math, XP/streak rules, or RLS policies — those are the places
  where a wrong answer looks completely plausible. Streak logic in particular has
  a timezone trap: day boundaries are **America/New_York**, not UTC.
- Use `dispatching-parallel-agents` where tasks are genuinely independent. Later
  milestones have obvious fan-out — the 10 drill modules in M2 don't depend on
  each other, and neither do the API route groups in M4. Milestone 1 is mostly
  sequential, so don't force it there.
- Use `requesting-code-review` between tasks, and `systematic-debugging` rather
  than guess-and-check if the deploy misbehaves. I'd expect trouble in three
  places: `@supabase/ssr` cookie handling (symptom: logged out on refresh), the
  Supabase pooler connection string (port 6543, not 5432), and Vercel Python
  cold starts.
- Use `finishing-a-development-branch` when milestone 1 is green and deployed.

Don't write implementation code until I've approved the design.
