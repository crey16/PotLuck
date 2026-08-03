# API surface

Extracted verbatim from StackSchool, annotated with what happens to each route.

Legend: **KEEP** port as-is · **CHANGE** port with modifications ·
**DROP** replaced by Supabase Auth · **NEW** does not exist yet

## auth — `/auth`

| Method | Path | Fate |
|---|---|---|
| POST | `/auth/register` | **DROP** → `supabase.auth.signUp()` |
| POST | `/auth/login` | **DROP** → `supabase.auth.signInWithPassword()` |
| POST | `/auth/refresh` | **DROP** → SDK handles refresh |
| POST | `/auth/logout` | **DROP** → `supabase.auth.signOut()` |
| POST | `/auth/forgot-password` | **DROP** → `supabase.auth.resetPasswordForEmail()` |
| POST | `/auth/reset-password` | **DROP** → `supabase.auth.updateUser()` |
| GET | `/auth/me` | **CHANGE** → read `profiles` where `id = auth.uid()` |

## content — `/content`

| Method | Path | Fate |
|---|---|---|
| GET | `/content/version` | **KEEP** — cache-busting for the client |
| GET | `/content/modules` | **KEEP** (or read directly from Supabase; it's public content) |
| GET | `/content/lessons` | **KEEP** |
| GET | `/content/scenarios` | **KEEP** |

These are read-only public content under RLS. Simplest option is to skip the API
entirely and select from Supabase in a server component.

## progress — `/progress`

| Method | Path | Fate |
|---|---|---|
| POST | `/progress/attempts` | **CHANGE** — accept `drill_kind`/`drill_payload` for client-generated drills |
| POST | `/progress/lesson-complete` | **KEEP** — requires every authored check, derives score from stored server-graded attempts, then awards first-completion XP and updates streak/activity |
| GET | `/progress/lessons` | **KEEP** |

## scenarios — `/scenarios`

| Method | Path | Fate |
|---|---|---|
| GET | `/scenarios/recommendation` | **KEEP** |
| GET | `/scenarios/random` | **KEEP** |
| POST | `/scenarios/submit` | **KEEP** — scoring + XP + skill stats |
| GET | `/scenarios/skill-stats` | **KEEP** |

## table_scenarios — `/table-scenarios`

| Method | Path | Fate |
|---|---|---|
| GET | `/table-scenarios/random` | **KEEP** |
| POST | `/table-scenarios/submit` | **KEEP** |

## daily — `/daily`

| Method | Path | Fate |
|---|---|---|
| GET | `/daily` | **KEEP** |
| POST | `/daily/complete` | **KEEP** — guarded by persisted completion/attempt evidence, idempotent per ET date, and streak-driving |

## recommendations — `/recommendations`

| Method | Path | Fate |
|---|---|---|
| GET | `/recommendations/next` | **KEEP** — rule-based, no AI |

## stats — `/stats`

| Method | Path | Fate |
|---|---|---|
| GET | `/stats/activity` | **KEEP** — powers the streak calendar |

## friends — ✅ shipped in M7 (`api/friends.py`)

| Method | Path | Fate |
|---|---|---|
| GET | `/users/search` | **DONE** — username prefix search, `relationship` annotated, private profiles hidden unless friends, email never touched |
| POST | `/friends/request` | **DONE** — guard cascade + auto-accept on a reverse pending request |
| GET | `/friends/requests` | **DONE** — `{incoming, outgoing}`, single join (no N+1) |
| POST | `/friends/respond` | **DONE** — `accept\|decline`; accept writes both `friends` rows in one transaction |
| DELETE | `/friends/requests/{id}` | **NEW, DONE** — cancel own pending outgoing |
| GET | `/friends` | **DONE** |
| DELETE | `/friends/{user_id}` | **NEW, DONE** — unfriend; removes both rows and the accepted request rows |

## health

| Method | Path | Fate |
|---|---|---|
| GET | `/health` | **KEEP** — useful for checking cold starts |

---

## New endpoints

### Durable play history — M8 shipped 2026-08-03

All routes are authenticated. The browser supplies identities and choices;
the API resolves the immutable solve pack, derives the grade and alternatives,
and writes the normalized coaching record and linked XP attempt atomically.

| Method | Path | Notes |
|---|---|---|
| POST | `/play/sessions` | Create/recover an idempotent session with a frozen supported configuration |
| POST | `/play/sessions/{session_id}/hands` | Create/recover a solve-backed hand |
| POST | `/play/hands/{hand_id}/decisions` | Validate the next node/action and persist server-derived grading + XP |
| PATCH | `/play/hands/{hand_id}` | Complete only a terminal branch, or abandon an interrupted hand |
| PATCH | `/play/sessions/{session_id}` | Complete or abandon a session; safely closes unfinished hands on abandonment |
| GET | `/play/sessions` | Recent owner-scoped sessions and trusted quality totals |
| GET | `/play/sessions/{session_id}/hands` | Recent owner-scoped hands |
| GET | `/play/hands/{hand_id}` | Full reloadable hand, decision, and action-alternative review |
| GET | `/play/pack` | Diagnostic: whether the deployed function can read the solve pack, and its verified content hash |

Generic `POST /progress/attempts` rejects `drill_kind = play`; play XP must flow
through the authoritative decision transaction.

### Leaderboards — ✅ shipped in M7, as direct Supabase reads (no endpoint)

The M7 decision: the `leaderboard` view is `security_invoker` and RLS-safe,
so the browser reads it directly (`lib/social/queries.ts`) and subscribes to
Realtime `postgres_changes` on `profiles` for liveness — no Python endpoint,
no cold start. Friends scope reads `profiles` filtered by friend ids so
private friends still rank. `metric=accuracy` remains future work and would
need a `skill_stats` rollup (materialised view + `pg_cron` if slow).

### Challenges

| Method | Path | Notes |
|---|---|---|
| POST | `/challenges` | Create; freezes N generated hands into `challenge_hands` |
| GET | `/challenges` | List yours, filtered by status |
| GET | `/challenges/{id}` | Includes hands only if you are a participant |
| POST | `/challenges/{id}/submit` | Records a `challenge_results` row; marks complete when both are in |

**Hands must be frozen at creation.** Both players answer identical spots or the
comparison is meaningless. Generate them with `lib/poker` (server-side via a
small Node script, or client-side at creation and POSTed up) and store the
payload.

### Activity feed

| Method | Path | Notes |
|---|---|---|
| GET | `/feed` | `activity_events` joined to `friends`, newest first, paginated |

Write events from the same places that award XP. Kinds to start with:
`lesson_complete`, `level_up`, `streak_milestone` (7/30/100), `challenge_win`.
Do not emit an event per attempt — the feed becomes noise.

### Profiles — ✅ shipped in M7

| Method | Path | Notes |
|---|---|---|
| GET | `/u/{username}` | **DONE as a page, not an endpoint** — server component reading under RLS; skill breakdown + heatmap visible to self/friends only; logged-in users only |
| PATCH | `/profile` | **DONE** (`api/profile.py`) — display name, bio, `is_public`; avatar deferred |

Respect `is_public`. RLS already enforces it; no bypass was built.
