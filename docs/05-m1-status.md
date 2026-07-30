# M1 status — shipped 2026-07-29

Read this before starting M2. It records what exists, where it lives, and what
was learned shipping it. Nothing here is aspirational; everything was verified
against production.

## Live infrastructure

| Thing | Value |
|---|---|
| Production URL | https://hcwk-wizard.vercel.app |
| GitHub | `crey16/PotLuck` (private), branch `main` — push = deploy |
| Vercel project | `hcwk-wizard` on team `reymatvei-5892s-projects` |
| Supabase org / project | HCWK / `hcwk-wizard`, ref `ajaryvyorhwnhinzubqd`, region `ca-central-1` |
| DB | Migration `0001` applied: 17 tables, RLS on all 17, `on_auth_user_created` trigger live |
| JWT signing | ECC P-256 (ES256) — `api/deps.py` JWKS verification confirmed working |
| API keys | New `sb_publishable_...` key system (not legacy anon JWTs); supabase-js ≥2.111 handles it |
| Secrets | Everything is in git-ignored `.env.local` (Supabase URL/key, pooler `DATABASE_URL` with the DB password, and a working test account's credentials in comments at the bottom). Vercel has the same four env vars set. `SUPABASE_SERVICE_ROLE_KEY` is used by nothing and set nowhere. |

## What a user can do today

Sign up with email+password (no confirmation email — deliberately disabled),
land on `/drill/outs`, answer hands with full worked-math feedback, earn 10 XP
per correct answer, and keep XP/level/streak across reloads. Streak day
boundaries are America/New_York and were verified with the UTC-vs-ET trap
tests plus a live check.

## Deliberate M1 decisions that M2 inherits

1. **Google OAuth deferred.** Button ships; provider unconfigured. Blocked on
   enabling MFA for the Google account before Google Cloud console access.
   Steps are at the top of the M2 section in `04-roadmap.md`.
2. **Supabase "Confirm email" is OFF** so signups get an instant session.
   Revisit when there's an SMTP story.
3. **Client-reported `is_correct` is trusted.** Fine until leaderboards make
   XP competitive (M3) — then re-grade server-side from `drill_payload`,
   which already contains everything needed.
4. **XP rule:** 10 per correct drill answer, 0 for incorrect;
   `level = xp // 100 + 1` lives in exactly one place (`api/progress.py`).

## Deploy learnings (the expensive ones)

- **Vercel + Next.js preset does NOT route `/api/*` to the Python function.**
  It exposes `api/index.py` only at its file path `/api/index`. The fix is the
  production rewrite in `next.config.ts` (`/api/:path*` → `/api/index`); the
  ASGI app still receives the original path. Don't remove it.
- The pooler DSN shape is
  `postgresql://postgres.<ref>:<pw>@aws-0-ca-central-1.pooler.supabase.com:6543/postgres`.
- `npm run api` feeds `.env.local` to uvicorn via `--env-file`; uvicorn
  hard-errors if the file is missing — use `npm run api:bare` /
  `npm run dev:all:bare` without credentials.
- Health probes: `/api/health` (function up) and `/api/health?db=1` (DB
  reachable) — they separate the two failure modes and both return in
  ~150–250 ms.

## Verification state

- 49 TypeScript tests + 17 pytest, all green (`npm test`,
  `.venv/bin/python -m pytest api/ -q`).
- Live production script passed 12/12: signup→trigger profile, XP/level/streak
  through the real API, incorrect answers earn 0, persistence across fresh
  reads, RLS two-account isolation, 401 for unauthenticated posts, daily
  activity upsert, correct ET dates.
- Test accounts (throwaway, plus-tagged on the owner's email):
  `tester` (credentials in `.env.local` comments) plus two disposable
  verification accounts.

## Where process artifacts live

- Approved M1 design: `docs/superpowers/specs/2026-07-29-milestone-1-design.md`
- Task-by-task ledger with review findings and triage decisions:
  `.superpowers/sdd/progress.md` (git-ignored, local only)
- Minor findings deliberately deferred: buildOpts short-candidate padding
  guard (needed before drill level 3), global keydown `e.target` guard (needed
  once any page has an input), toast on persistence failure, `AttemptIn`
  Pydantic constraints (`Literal` drill kinds, `max_length`), a
  `requirements-dev.txt` split, aria attributes on drill controls (M6), theme
  toggle replacing hardcoded `data-theme="dark"` (M6), Next 16
  middleware→proxy rename (watch the deprecation warning).
