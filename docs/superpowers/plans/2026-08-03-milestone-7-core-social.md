# M7 Core Social Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship friends, live leaderboards, and public profiles per `docs/superpowers/specs/2026-08-03-milestone-7-core-social-design.md`.

**Architecture:** Hybrid — all writes and friend-request logic in FastAPI (`api/friends.py`, `api/profile.py`) over the pooled psycopg connection; RLS-secured reads (leaderboard, profile pages) direct from Supabase, isolated in `lib/social/queries.ts`. One new migration adds delete policies, a status CHECK, and Realtime on `profiles`.

**Tech Stack:** FastAPI + psycopg (existing), Next.js App Router server components + client islands (existing), `@supabase/ssr` clients (existing), Supabase Realtime `postgres_changes`.

## Global Constraints

- Literal `/api` prefix on every FastAPI route decorator; no router prefixes.
- Identity only from `Depends(current_user_id)`; never from a body.
- DB writes: `with get_connection() as conn:` + `try/except → rollback/raise` + `conn.commit()`.
- Friend-request statuses: `pending | accepted | declined` (never `rejected`).
- Relationship vocabulary: `none | friends | pending_outgoing | pending_incoming`.
- Never select, match, or return `email` anywhere in social code.
- TS: strict, no `any`, no `setState` in `useEffect`, no import file extensions under `lib/`, Tailwind-free inline style + existing CSS classes per Industry system.
- Tests co-located; `node:test` via `tsx --test`; pytest in `api/test_*.py` with monkeypatched DB, no network.
- No AI attribution trailers in commits.
- Do NOT push to `main` (auto-deploys). Work stays on `m7-social`.

---

### Task 1: Migration `0003_social_policies.sql`

**Files:**
- Create: `supabase/migrations/0003_social_policies.sql`

**Interfaces:** Produces DB state later tasks assume: status CHECK, delete policies, `profiles` in the `supabase_realtime` publication.

- [ ] **Step 1: Write the migration**

```sql
-- 0003_social_policies.sql — M7 core social gaps.
-- 0001 shipped the whole social schema; this fills what M7 needs:
-- a status vocabulary check, delete policies for cancel/unfriend, and
-- Realtime on profiles for the live leaderboard.

-- 1. Status vocabulary. Settled as pending|accepted|declined (0001's
--    comment said declined; StackSchool's code said rejected — declined wins).
alter table public.friend_requests
  add constraint friend_requests_status_check
  check (status in ('pending', 'accepted', 'declined'));

-- 2. Cancel: a sender may delete their own pending request.
create policy "cancel own pending request" on public.friend_requests
  for delete using (from_user_id = auth.uid() and status = 'pending');

-- 3. Unfriend: either side of a friendship row may delete it.
--    (No INSERT policy on friends — deliberate. Rows are created only by
--    the FastAPI accept path, two at a time, in one transaction.)
create policy "unfriend" on public.friends
  for delete using (user_id = auth.uid() or friend_user_id = auth.uid());

-- 4. Live leaderboard: publish profile updates. postgres_changes respects
--    RLS, so private profiles' updates never reach other subscribers.
alter publication supabase_realtime add table public.profiles;
```

- [ ] **Step 2: Commit** — `git add supabase/migrations/0003_social_policies.sql && git commit -m "feat: social RLS gaps + realtime migration"`. (Applying to production is a release step at the end, with the user.)

---

### Task 2: `api/friends.py` — search with relationship annotation (TDD)

**Files:**
- Create: `api/friends.py`, `api/test_friends.py`
- Modify: `api/index.py` (register router)

**Interfaces:**
- Produces: `GET /api/users/search?q=` → `list[UserSearchOut]` where `UserSearchOut = {id: str, username: str, display_name: str | None, level: int, streak_count: int, relationship: "none"|"friends"|"pending_outgoing"|"pending_incoming"}`.
- Produces module constants `RELATIONSHIPS = ("none", "friends", "pending_outgoing", "pending_incoming")` and `REQUEST_STATUSES = ("pending", "accepted", "declined")` for the cross-language test.

- [ ] **Step 1: Failing tests** — in `api/test_friends.py`, follow the `api/test_daily.py` pattern (in-module app + TestClient, `app.dependency_overrides[current_user_id]`, monkeypatched `get_connection` returning a fake cursor). Cover: 401 without token; empty q → 422; results exclude self; private non-friend profile absent; private friend present with `relationship="friends"`; pending outgoing/incoming annotated; no `email` key in any row.
- [ ] **Step 2: Run** `pytest api/test_friends.py -q` — fails (module missing).
- [ ] **Step 3: Implement.** One SQL statement does search + visibility + relationship:

```sql
select p.id, p.username, p.display_name, p.level, p.streak_count,
       (f.user_id is not null) as is_friend,
       fr_out.id is not null as pending_outgoing,
       fr_in.id is not null as pending_incoming
from profiles p
left join friends f on f.user_id = %(me)s and f.friend_user_id = p.id
left join friend_requests fr_out
  on fr_out.from_user_id = %(me)s and fr_out.to_user_id = p.id
 and fr_out.status = 'pending'
left join friend_requests fr_in
  on fr_in.from_user_id = p.id and fr_in.to_user_id = %(me)s
 and fr_in.status = 'pending'
where lower(p.username) like %(prefix)s
  and p.id <> %(me)s
  and (p.is_public or f.user_id is not null)
order by lower(p.username)
limit 10
```

`prefix` is `q.lower()` with `%`/`_` escaped (`like ... escape '\'`) plus `%`. Relationship precedence: `friends` > `pending_outgoing` > `pending_incoming` > `none`.
- [ ] **Step 4: Tests pass**, then **Step 5: Commit** `feat: friend search with relationship annotation`.

---

### Task 3: `api/friends.py` — request / respond / cancel / list / unfriend

**Files:**
- Modify: `api/friends.py`, `api/test_friends.py`

**Interfaces:**
- `POST /api/friends/request` `{to_user_id}` → `{"status": "pending", "request_id": int}` or `{"status": "accepted"}` (auto-accept).
- `GET /api/friends/requests` → `{"incoming": [RequestOut], "outgoing": [RequestOut]}` with `RequestOut = {id, from_user_id, to_user_id, created_at, user: UserSearchOut-minus-relationship}` (the *other* party's profile).
- `POST /api/friends/respond` `{request_id, action: "accept"|"decline"}` → `{"status": ...}`.
- `DELETE /api/friends/requests/{request_id}` → `{"status": "cancelled"}`.
- `GET /api/friends` → `list[{id, username, display_name, level, streak_count, xp}]`.
- `DELETE /api/friends/{friend_user_id}` → `{"status": "removed"}`.
- Internal helper `_create_friendship(cur, a, b)` inserting both rows with `on conflict do nothing`.

- [ ] **Step 1: Failing tests** for the guard cascade in order: self-request 400; missing target 404; already friends 409; duplicate pending 409; reverse-pending auto-accepts (both friends rows written, reverse request marked accepted); respond scoped to recipient + pending else 404; invalid action 400; decline leaves no friendship; cancel only own pending outgoing else 404; unfriend deletes both rows + accepted request rows both directions, 404 when not friends; re-request after unfriend succeeds (no unique-constraint corpse).
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement.** Port StackSchool's cascade (reference `~/PycharmProjects/PokerDuolingo/backend/app/routes/friends.py`, read-only) onto psycopg; single-join request listings (no N+1); every mutation in one transaction. Unfriend:

```sql
delete from friends
 where (user_id = %(me)s and friend_user_id = %(other)s)
    or (user_id = %(other)s and friend_user_id = %(me)s);
delete from friend_requests
 where status = 'accepted'
   and ((from_user_id = %(me)s and to_user_id = %(other)s)
     or (from_user_id = %(other)s and to_user_id = %(me)s));
```

404 if the first delete removed zero rows (rollback, not commit).
- [ ] **Step 4: Tests pass.** **Step 5: Commit** `feat: friend request lifecycle endpoints`.

---

### Task 4: `api/profile.py` — PATCH profile

**Files:**
- Create: `api/profile.py`, `api/test_profile.py`
- Modify: `api/index.py`

**Interfaces:** `PATCH /api/profile` body `{display_name?: str, bio?: str, is_public?: bool}` → full updated `{id, username, display_name, bio, is_public, xp, level, streak_count}`.

- [ ] **Step 1: Failing tests:** empty body 422; display_name trimmed, 1–40 chars enforced (41 → 422; whitespace-only → 422); bio ≤ 280 (281 → 422); bio may be cleared with `""` → stored as null; partial update leaves other fields; is_public toggles; 401 without token.
- [ ] **Step 2: fail. Step 3:** Pydantic model with `model_config = ConfigDict(extra="forbid")`, validators for trim/length; dynamic `set` clause built only from provided fields (parameterized, never interpolated values). **Step 4: pass. Step 5: Commit** `feat: profile editing endpoint`.

---

### Task 5: Cross-language vocabulary pin + `lib/social` foundation

**Files:**
- Create: `lib/social/types.ts`, `lib/social/api.ts`, `api/test_social_vocab_matches_typescript.py`
- Modify: `package.json` (add `lib/social` glob to the `test` script)

**Interfaces:**
- `types.ts` exports `REQUEST_STATUSES`, `RELATIONSHIPS` as const tuples plus `Relationship`, `FriendProfile`, `FriendRequestEntry`, `SearchResult`, `LeaderboardRow {id, username, display_name, level, streak_count, xp}`, `OwnProfile`.
- `api.ts` (`"use client"`): `SocialApiError`, private `authRequest<T>` (copy of the learn idiom), and `searchUsers(q)`, `sendFriendRequest(toUserId)`, `listFriendRequests()`, `respondToRequest(id, action)`, `cancelRequest(id)`, `listFriends()`, `unfriend(userId)`, `updateProfile(patch)`.
- `api/test_social_vocab_matches_typescript.py` parses `lib/social/types.ts` with a regex for the two const tuples and asserts equality with `api.friends.REQUEST_STATUSES` / `RELATIONSHIPS` — same style as `api/test_drill_kinds_match_typescript.py`.

- [ ] Steps: write pin test (fails) → write `types.ts` + `api.ts` → pytest + `npm test` pass → commit `feat: social client api + cross-language vocab pin`.

---

### Task 6: `lib/social/leaderboard.ts` + `queries.ts` (TDD on the pure logic)

**Files:**
- Create: `lib/social/leaderboard.ts`, `lib/social/leaderboard.test.ts`, `lib/social/queries.ts`

**Interfaces:**
- `leaderboard.ts` (pure, tested): `type Metric = "xp" | "streak"`, `sortRows(rows, metric)` (desc by metric, tie-break xp then `lower(username)` asc), `applyProfileUpdate(rows, update, scopeIds?)` → new sorted array; an update for an id not in `scopeIds` (when given) is ignored; an update with `is_public=false` removes the row (global scope); returns `{rows, movedId}` so the UI can flash the mover. `injectSelf(rows, self)` — adds the caller's row when absent (private caller), marked `unranked: true`.
- `queries.ts` (the ONLY Supabase-coupled social reads): `fetchGlobalLeaderboard(supabase, limit=100)` from the `leaderboard` view; `fetchFriendIds(supabase, myId)` from `friends`; `fetchFriendsLeaderboard(supabase, myId)` — `profiles` by `id in (friendIds ∪ me)` (RLS grants friend reads, so private friends still rank); `fetchProfileByUsername(supabase, username)`; `fetchSkillStats(supabase, userId)`; `fetchDailyActivity(supabase, userId, start, end)`.

- [ ] Steps: failing tests for sort/tie-break/update/remove-on-private/ignore-out-of-scope/injectSelf → implement → `npm test` green → commit `feat: leaderboard logic + social queries module`.

---

### Task 7: Shared profile widgets + `/u/[username]`

**Files:**
- Create: `app/u/[username]/page.tsx`, `components/social/ProfileView.tsx`, `components/social/ProfileEditPanel.tsx`
- Modify: extract the skill-strength bars and 12-week heatmap from `app/page.tsx` into `components/social/` (or reuse in place if they are already standalone components — check first) so Home and profiles share one implementation.

**Behavior (from spec):** server component; `fetchProfileByUsername` under RLS; null → `notFound()`. Identity plate (display name, @username, level, XP, streak). Skill bars + heatmap only when RLS returns rows (self or friend); public non-friend sees a "visible to friends" plate. Self sees Edit → `ProfileEditPanel` (client island: display_name, bio, is_public toggle with copy "Public profiles appear in search and on the global leaderboard"; saves via `updateProfile`, inline error text on failure, `router.refresh()` on success).

- [ ] Steps: extract widgets (run `npm test` + `tsc` to prove Home unbroken) → build page + panel → manual dev-server smoke → commit `feat: public profile page with edit panel`.

---

### Task 8: `/friends` page

**Files:**
- Create: `app/friends/page.tsx`, `components/social/FriendsShell.tsx` (client)

**Behavior:** server component fetches nothing (all data is auth-scoped API calls) — render `FriendsShell`, which loads via `lib/social/api.ts` on mount and shows three plates: (1) requests — incoming rows with Accept/Decline, outgoing with Cancel; (2) roster — username, level, streak, link to `/u/[username]`, Unfriend behind a two-click confirm (button becomes "Confirm?" for 3s); (3) add friends — debounced (300ms) search input, per-row button by `relationship`: none→"Add", pending_outgoing→"Requested" (disabled), pending_incoming→"Accept", friends→"Friends" (disabled). Mutations update local state from the response (auto-accept flips a row to friends immediately); errors render inline under the acting row.

- [ ] Steps: build → dev-server smoke (two accounts if `.env.local` test creds allow) → commit `feat: friends page`.

---

### Task 9: `/leaderboard` page with Realtime

**Files:**
- Create: `app/leaderboard/page.tsx`, `components/social/LeaderboardShell.tsx` (client)

**Behavior:** server component fetches initial global rows + friend ids + own profile row and passes them down. Shell holds scope (`global | friends`) and metric (`xp | streak`) toggles (mono-label buttons, Industry style); friends scope rows fetched client-side on first switch via `fetchFriendsLeaderboard`. Realtime: one channel, `postgres_changes` `UPDATE` on `public.profiles`, handler maps payload → `applyProfileUpdate` for the active scope, mover row gets a brief accent flash (CSS class toggled by `movedId`, cleared on `transitionend`/timeout). Private caller: `injectSelf` row with "private — not ranked publicly" note in global scope. Rank numbers, self row highlighted, top 100 global.

- [ ] Steps: build → smoke (earn XP in a second tab, watch the row move) → commit `feat: live leaderboard`.

---

### Task 10: Navigation + home card + docs

**Files:**
- Modify: `components/ui/SiteHeader.tsx` (NAV gains `{href:"/friends",label:"Friends"}` and `{href:"/leaderboard",label:"Ranks"}`; account menu gains a "Profile" item linking to `/u/${username}`), `app/page.tsx` (reserved "Friends · leaderboards · head-to-head" card becomes live links to /friends and /leaderboard), `docs/04-roadmap.md` (M7 section: mark shipped items, note M7.5 deferrals), `CLAUDE.md` current-state block, `docs/03-api-surface.md` (record the shipped social surface).

- [ ] Steps: edit → `npm test`, `tsc`, lint, `next build` all green → commit `feat: social navigation + docs`.

---

### Task 11: Verification (verification-before-completion)

- [ ] `npm test` — all suites including `lib/social` green.
- [ ] `pytest` — all green.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build` — clean.
- [ ] Grep the build output for `SUPABASE_SERVICE_ROLE_KEY` (roadmap sanity check).
- [ ] Record results in `docs/09-m7-status.md` (architecture, decisions, verification record, and the **release steps left for the user**: apply `0003` to production, then run the two-account live checks from the spec).

**NOT in this plan (release steps requiring the user):** applying the migration to the production database, deploying, and the live two-account verification round.
