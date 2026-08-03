# M7 status — core social (SHIPPED 2026-08-03)

Friends, live leaderboards, public profiles and profile editing, per the
approved spec (`docs/superpowers/specs/2026-08-03-milestone-7-core-social-design.md`)
and plan (`docs/superpowers/plans/2026-08-03-milestone-7-core-social.md`).
Challenges and the activity feed are M7.5. Merged to `main` and
deployed 2026-08-03; migration `0003` applied to production and verified.

## Architecture (settled)

Hybrid along the read/write line:

- **Writes and friend-request logic → FastAPI.** `api/friends.py` (search,
  request, respond, cancel, roster, unfriend) and `api/profile.py`
  (PATCH). The two `friends` rows of a friendship are only ever written
  together, in one transaction, by the accept path — RLS has no INSERT
  policy on `friends`, deliberately.
- **RLS-secured reads → Supabase directly**, isolated in
  `lib/social/queries.ts` (the whole Supabase-coupled surface besides the
  Realtime channel in `LeaderboardShell`). Portability escape hatch:
  moving off Supabase rewrites that one module.
- **Liveness → Realtime** `postgres_changes` UPDATE on `profiles`
  (respects RLS). The board re-sorts in place with a mover flash;
  subscription failure degrades silently to the server-rendered rows.

## What shipped where

| Piece | Files |
|---|---|
| Migration | `supabase/migrations/0003_social_policies.sql` — status CHECK (`pending\|accepted\|declined`), cancel + unfriend DELETE policies, `profiles` into the `supabase_realtime` publication |
| Friends API | `api/friends.py`, tests `api/test_friends.py` (guard cascade, auto-accept, relationship precedence, LIKE escaping) |
| Profile API | `api/profile.py`, tests `api/test_profile.py` (bounds, trim, clear-bio, extra="forbid") |
| Vocab pin | `api/test_social_vocab_matches_typescript.py` ↔ `lib/social/types.ts` |
| Client lib | `lib/social/{types,api,queries,leaderboard}.ts`, tests `lib/social/leaderboard.test.ts` |
| Friends page | `app/friends/page.tsx`, `components/social/FriendsShell.tsx` |
| Leaderboard | `app/leaderboard/page.tsx`, `components/social/LeaderboardShell.tsx` |
| Profile page | `app/u/[username]/page.tsx`, `components/social/{ProfileEditPanel,ProfileWidgets}.tsx` (widgets extracted from Home — Home now shares them) |
| Nav + home | `components/ui/SiteHeader.tsx` (Friends, Ranks, account-menu Profile link), `app/page.tsx` (reserved card is live) |

## Decisions worth remembering

- **`declined`, never `rejected`.** 0001's comment won over StackSchool's
  code; the CHECK constraint now enforces it.
- **Auto-accept on reverse request** (A requests B while B's request to A
  is pending → instant friendship) — ported from StackSchool; the search
  UI leans on it: an "Accept" button in search results is just
  `sendFriendRequest`.
- **Search visibility = `is_public` OR already-friends**, computed in SQL
  (the service connection bypasses RLS, so the filter is explicit).
  Private profiles never appear in a stranger's search; email is never
  selected anywhere.
- **Friends board reads `profiles`, not the `leaderboard` view** — RLS
  grants friend reads, so private friends still rank among friends. The
  global board is the view (public only, top 100); a caller absent from
  it gets an injected unranked row ("outside the top 100" vs "private —
  not ranked publicly").
- **Profile page 404s identically** for missing and RLS-hidden profiles —
  existence is never confirmed. Skill bars/heatmap render only when RLS
  returns rows (self or friend); public non-friends get a "visible to
  friends" plate.
- **Unfriend deletes the accepted `friend_requests` rows too**, or the
  `unique(from,to)` constraint would block ever re-friending.
- **Profiles are logged-in only** (user decision) — no anon policy, no OG
  data, `PUBLIC_PREFIXES` untouched.

## Traps hit (and their fixes)

- The design system defines `--space-{1,2,3,4,6,8}` — **5 and 7 do not
  exist**, and `components/ui/spacing.test.ts` fails the suite if a new
  file uses them.
- House lint forbids **synchronous setState inside useEffect** and
  **ref reads during render**. FriendsShell moves search-state flips into
  the change handler (the effect owns only the timer + fetch); the
  leaderboard resubscribes its Realtime channel on metric/scope change
  instead of smuggling current values through refs.
- `api/` tests run with `.venv/bin/python -m pytest` — the system Python
  lacks psycopg.

## Verification record (local, 2026-08-03)

- `npm test` — 272 tests, 0 fail (includes new `lib/social` suite).
- `.venv/bin/python -m pytest api/` — 95 passed.
- `npx tsc --noEmit` — clean. `npm run lint` — 0 errors (10 pre-existing
  warnings, none in social files). `npm run build` — clean; all routes
  compile, `/friends`, `/leaderboard`, `/u/[username]` present.
- `grep -rl SUPABASE_SERVICE_ROLE_KEY .next/static` — empty.

## Release record (2026-08-03)

1. `0003` applied to production via psycopg; CHECK constraint, both
   policies, and the `profiles` Realtime publication row verified in
   `pg_constraint` / `pg_policies` / `pg_publication_tables`.
2. `m7-social` fast-forwarded into `main` and pushed; Vercel deploy
   confirmed live (the old function 404s `/api/users/search`, the new one
   401s it — that flip was the deploy signal, since middleware 307s make
   page URLs look live on the old build too).
3. Production API verified with the test account: friends and requests
   lists 200, username search returns `relationship` and never email,
   PATCH profile set-and-revert, self-request and unfriend guards 404/400,
   no-token 401. Still worth a human pass: a two-account browser session
   exercising accept/decline/unfriend and watching the board move live.
