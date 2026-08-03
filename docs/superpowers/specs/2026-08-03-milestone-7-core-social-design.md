# Milestone 7 design — core social

**Status:** approved design, 2026-08-03

## Scope decision

M7 ships the core social slice: **friends, leaderboards, and public
profiles**, plus profile editing, unfriend/cancel-request, and the streak
heatmap on friend profiles. Challenges and the activity feed move to an
M7.5 follow-up — challenges depend on friends existing, and a feed with no
friends is an empty page. Also deferred: the accuracy leaderboard metric
(needs a `skill_stats` rollup that does not exist yet), avatar image upload
(avatars stay initials/placeholder), and anonymous access (see below).

Settled during brainstorming:

- **Profiles are visible to logged-in users only.** No anonymous RLS
  policy, no service-role render. A signed-out visit to `/u/[username]`
  redirects to login like any other protected route.
- **Leaderboard metrics are XP and streak, live.** Global and friends
  scopes. Read directly from the `leaderboard` view in the browser with a
  Supabase Realtime subscription so it moves while you watch.
- **Architecture is hybrid along the read/write line.** All writes and
  multi-step logic go through FastAPI; reads that RLS already secures go
  direct from Supabase, isolated behind `lib/social/` so the
  Supabase-coupled surface stays one module (portability escape hatch).

## What already exists

Migration `0001_initial_schema.sql` shipped the entire social schema at M1:
`friend_requests`, `friends` (bidirectional, two rows), `challenges` +
hands + results (untouched this milestone), `activity_events` (untouched),
the `leaderboard` view (`security_invoker = true`, `is_public` filter,
ordered by XP), the `is_friend()` helper, the case-insensitive
`profiles_username_idx`, and RLS policies for reads and friend-request
writes. StackSchool's `routes/friends.py` is the reference for the friend
request state machine; leaderboards and profiles have no reference
implementation and are new surface.

## Data layer — migration `0003_social_policies.sql`

The only new migration, filling gaps rather than adding structure:

1. **Status vocabulary.** Settle on `pending | accepted | declined`
   (matching the 0001 comment; StackSchool used `rejected`) and add a CHECK
   constraint on `friend_requests.status` so drift cannot recur.
2. **DELETE policies.** `friend_requests`: a sender may delete their own
   pending request (cancel). `friends`: either side of a row may delete it
   (unfriend). The FastAPI service connection bypasses RLS anyway; the
   policies document intent and keep a future direct-client path open.
3. **No INSERT policy on `friends` — deliberate.** Friendship rows are
   created only by the FastAPI accept path, two rows in one transaction.
   Leaving RLS closed there encodes that invariant.
4. **Realtime.** Add `public.profiles` to the `supabase_realtime`
   publication so the leaderboard can subscribe to XP/streak updates.
   Realtime `postgres_changes` respects RLS, so private profiles' updates
   never reach subscribers — consistent with the view.

Unfriend semantics: one FastAPI transaction deletes both `friends` rows
**and** any accepted `friend_requests` rows between the pair, so the two
can re-friend later without tripping `unique(from_user_id, to_user_id)`.

## API — `api/friends.py` and `api/profile.py`

House rules apply throughout: literal `/api` prefix on every decorator,
`user_id: str = Depends(current_user_id)`, `get_connection()` with
rollback-on-error, Pydantic in/out models, lowercase error details.

`api/friends.py`:

- `GET /api/users/search?q=` — username prefix match on
  `lower(username)` (uses `profiles_username_idx`), min length 1, max 100,
  excludes self, limit 10, ordered by username. Only profiles that are
  `is_public` **or already friends** appear — `is_public = false` genuinely
  hides a profile from search (roadmap acceptance item). Never matches or
  returns email. Each row carries a `relationship` field
  (`none | friends | pending_outgoing | pending_incoming`) so the UI can
  render the right button without extra requests.
- `POST /api/friends/request` `{to_user_id}` — guard cascade in order:
  self-request 400; target missing 404; already friends 409; existing
  pending outgoing 409; **existing pending reverse request auto-accepts**
  (marks it accepted, creates the friendship, returns
  `{"status": "accepted"}`); otherwise inserts pending and returns
  `{"status": "pending", "request_id"}`. Ported from StackSchool including
  the auto-accept.
- `GET /api/friends/requests` — `{incoming, outgoing}`, pending only,
  newest first, profile info attached via a single join (fixes the
  reference implementation's N+1).
- `POST /api/friends/respond` `{request_id, action}` — action is
  `accept | decline` (else 400); request must be addressed to the caller
  and pending (else 404). Accept inserts both `friends` rows and marks the
  request accepted in one transaction.
- `DELETE /api/friends/requests/{request_id}` — cancel; must be the
  caller's own pending outgoing request (else 404).
- `GET /api/friends` — the caller's friends with profile info
  (`id, username, display_name, level, streak_count, xp`), one join.
- `DELETE /api/friends/{friend_user_id}` — unfriend; 404 if not currently
  friends; deletes both rows plus accepted request rows between the pair.

`api/profile.py`:

- `PATCH /api/profile` `{display_name?, bio?, is_public?}` — partial
  update, at least one field required. `display_name` 1–40 chars trimmed,
  `bio` up to 280 chars, `is_public` boolean. Returns the updated profile.
  Username changes are out of scope (username is identity).

## Frontend

New module `lib/social/`: `types.ts`, `api.ts` (client calls mirroring
`lib/learn/api.ts`, `SocialApiError`), `queries.ts` (every direct Supabase
read for social — leaderboard, profile page, friend ids — lives here and
nowhere else), plus pure helpers (`leaderboard.ts` for sort/merge logic)
that carry unit tests.

Routes and components, all in the Industry blueprint language (hairline
panels, Barlow Condensed headings, monospaced uppercase metadata, existing
accent token, no new colours):

- **`/friends`** — three plates: pending requests (incoming with
  accept/decline, outgoing with cancel), the friends roster (username,
  level, streak, link to profile, unfriend behind a confirm), and add-a
  -friend search (debounced, relationship-aware button states). Server
  component fetches the initial roster/requests through FastAPI
  (`serverApi` idiom, null-safe); a client island handles mutation and
  refresh.
- **`/leaderboard`** — global | friends scope toggle and XP | streak
  metric toggle. Initial rows server-rendered from the `leaderboard` view;
  a client component subscribes to Realtime `UPDATE`s on `profiles` and
  re-sorts in place, briefly marking movers. Friends scope queries
  `profiles` directly (not the view) for the caller's friend ids plus
  self — RLS grants friend reads, so **private friends still rank on a
  friends board**, which is the whole point of being friends. Global
  scope uses the view (public only); a private caller is absent there,
  so their own row is fetched separately and shown with a "private — not
  ranked publicly" note. Top 100 for global scope; friends scope is
  unpaginated (friend counts are small).
- **`/u/[username]`** — server component; looks up the profile by
  username under RLS, so visibility is exactly the `read own profile`
  policy (own, public, or friend) and a hidden profile 404s rather than
  confirming existence. Shows identity plate (display name, @username,
  level, XP, streak), and — only where RLS permits, i.e. self or friend —
  the skill-strength bars from `skill_stats` and the 12-week streak
  heatmap from `user_daily_activity` (both components already exist on
  Home; extract to shared components rather than duplicate). For a public
  non-friend profile those sections render a quiet "visible to friends"
  plate. Self view gets an Edit action.
- **Profile editing** — on own `/u/[username]`, an edit panel (client
  island) for display name, bio, and the `is_public` toggle with copy
  explaining exactly what public means (leaderboard + search + profile
  visibility). Saves through `PATCH /api/profile`.
- **Navigation** — `SiteHeader` NAV gains **Friends** and **Ranks**;
  the header username links to own profile. Home's reserved "Friends ·
  leaderboards · head-to-head" placeholder card becomes live links.

No changes to `PUBLIC_PREFIXES` — social routes are all authenticated.

## Error handling

- API mutations surface `SocialApiError` messages inline on the acting
  control (the drill/learn pattern); no toasts library.
- Realtime subscription failure degrades silently to the server-rendered
  board (it is already correct at render time); no retry loop.
- Server-side social fetches follow the `serverApi` convention of
  returning null and rendering an honest empty/error plate rather than
  crashing the page.
- Race on double-accept or accept-after-cancel resolves at the database:
  unique constraints make the second write a no-op surfaced as 404/409.

## Testing

- **pytest** (`api/test_friends.py`, `api/test_profile.py`): the full
  guard cascade including auto-accept, decline, cancel, unfriend (both
  rows and the request row gone, re-friend possible), search visibility
  (private profiles hidden unless friends; email never present),
  relationship annotation, profile patch validation bounds, and 401s
  without a token. Established pattern: in-module `FastAPI()` +
  `TestClient`, monkeypatched DB, no network.
- **TypeScript** (`lib/social/*.test.ts`, glob added to the `package.json`
  test script): leaderboard sort/merge/re-sort on a Realtime update event,
  self-row injection for private callers, relationship-state button
  mapping. `node:test` via `tsx --test`, co-located, like every other lib.
- **Cross-language invariant:** friend-request status values and the
  relationship vocabulary pinned across TS and Python in the style of
  `test_drill_kinds_match_typescript.py`.
- **Verification before completion:** `npm test`, `pytest`, `tsc`, lint,
  `next build` all green locally; then the two-account live checks —
  request/auto-accept/decline/cancel/unfriend round-trip, RLS isolation
  (non-friend cannot read a private profile or anyone's `skill_stats`),
  leaderboard moves live while a second account earns XP, and
  `is_public = false` hides a profile from search, leaderboard, and
  direct visit.

## Done when

You can search a friend by username, send a request they accept (or that
auto-accepts), see them on a live friends leaderboard that moves as they
earn XP, open their profile with skill bars and streak heatmap, edit your
own profile and go private — and a private profile is genuinely invisible
to non-friends everywhere: search, leaderboard, and direct link.
