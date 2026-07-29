# Migrating from StackSchool

Source: `~/PycharmProjects/PokerDuolingo` — **read-only, never modify it.**

FastAPI + SQLAlchemy/Alembic + Postgres (Docker), Expo React Native client.
2,584 lines of Python across 15 tables and 30 endpoints; 7,916 lines of TS across
15 screens.

## The one breaking change: integer ids become UUIDs

StackSchool keys everything off `users.id` as an autoincrement **integer**.
Supabase Auth issues **UUIDs**. Every user foreign key changes type.

This is the single largest mechanical task in the port, and it touches:

- `models.py` — `user_id: Mapped[int]` → `Mapped[uuid.UUID]` on 9 tables
- every route that reads `current_user.id`
- every Pydantic schema exposing a user id
- the mobile app's `types/index.ts`, if you keep it running

`supabase/migrations/0001_initial_schema.sql` already expresses the target
schema. **Your existing Alembic history does not apply to it** — Supabase owns
migrations now. Options:

- **Recommended:** drop Alembic. Supabase migrations are the source of truth;
  SQLAlchemy models become read/write mappings that must match, not generate.
- Or keep Alembic pointed at Supabase and skip the Supabase CLI. Workable, but
  you lose `supabase db diff` and the RLS policies have to be hand-managed.

There is no user data worth preserving (dev only), so no data migration is
needed. Users re-register.

## Table-by-table

| StackSchool | Fate | Notes |
|---|---|---|
| `users` | **Replaced** by `profiles` | id → uuid FK to `auth.users`. `hashed_password` dropped. Gains `username`, `display_name`, `avatar_url`, `bio`, `is_public`. |
| `refresh_tokens` | **Deleted** | Supabase Auth handles session refresh. |
| `password_reset_tokens` | **Deleted** | Supabase Auth handles reset emails. |
| `modules` | Kept as-is | |
| `lessons` | Kept as-is | `lesson_type` becomes a real Postgres enum. |
| `scenarios` | Kept as-is | |
| `table_scenarios` | Kept as-is | |
| `attempts` | Kept + extended | New `drill_kind` and `drill_payload` columns so client-generated drills can be recorded. |
| `progress` | Kept | Gains a `unique(user_id, lesson_id)` constraint it should always have had. |
| `skill_stats` | Kept as-is | |
| `user_daily_activity` | Kept as-is | |
| `daily_content` | Kept as-is | |
| `user_daily_completions` | Kept as-is | |
| `friend_requests` | Kept + `check (from ≠ to)` | |
| `friends` | Kept + `check (user ≠ friend)` | Still bidirectional: two rows per friendship. |
| — | **New:** `challenges`, `challenge_hands`, `challenge_results` | Head-to-head. |
| — | **New:** `activity_events` | Feed. |
| — | **New:** `leaderboard` view | Respects `is_public`. |

## Logic to port carefully

These are the parts where a careless rewrite silently changes behaviour.

### Streaks (`routes/progress.py::_update_streak`)

Day boundaries are **America/New_York**, not UTC. A user finishing a lesson at
9pm ET must not have it counted as the next day. `activity.py` uses
`zoneinfo.ZoneInfo("America/New_York")`. Keep that, and keep it in one place.

Rule: if `last_active_date` is yesterday → `streak_count += 1`; if it is today →
no change; otherwise → `streak_count = 1`.

### XP and level

`level = (xp // 100) + 1`, recomputed on every XP award. Denormalised onto the
profile so leaderboards are a single indexed read. Three different routes do
this today (`progress.py`, `scenarios.py`, `daily.py`) — **consolidate into one
helper during the port**, it is currently duplicated three times.

### Daily activity upsert (`activity.py`)

Postgres `INSERT ... ON CONFLICT DO UPDATE` with incrementing set-clauses, so it
is safe to call several times in one request. Do not replace with read-modify-write.

### Recommendations (`routes/recommendations.py`)

Deterministic and rule-based. No AI, and it should stay that way — it is fast,
explainable, and testable.

1. Find the weakest skill tag with `total_attempts >= 5`.
2. If an uncompleted lesson targets it, return that lesson.
3. Otherwise return a scenario filtered by that skill, at a difficulty from
   accuracy: `<0.40 → 1`, `<0.75 → 2`, else `3`.
4. New users get the first uncompleted lesson of the Foundations module.

### Friend requests (`routes/friends.py`)

Accepting a request writes **two** `friends` rows. The unique constraint on
`(from_user_id, to_user_id)` means a reverse request while one is pending needs
handling — check how the existing route does it before rewriting.

## Endpoints that disappear

Supabase Auth replaces these six outright:

- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`,
  `POST /auth/logout`, `POST /auth/forgot-password`, `POST /auth/reset-password`

`GET /auth/me` becomes a `profiles` read.

## Frontend port

The Expo screens are the specification for the web screens, not the source.
Reusable: the API client shape (`src/api/client.ts`), the store logic
(`authStore.ts`, `progressStore.ts` — Zustand works fine in Next.js), the types,
and `passwordValidation.ts` (though Supabase Auth handles most of it now).

Screen mapping:

| Expo screen | Web route |
|---|---|
| Login / Register / ForgotPassword / ResetPassword | `/login` (Supabase Auth UI or custom) |
| Home | `/` dashboard |
| ModuleDetail | `/learn/[moduleId]` |
| LessonPlayer | `/learn/[moduleId]/[lessonId]` |
| ScenarioPlayer, TableScenario | `/drill/[kind]` |
| ActivityCalendar | `/profile` (streak heatmap) |
| Friends / AddFriends / FriendRequests | `/friends` |
| — new — | `/charts` (preflop grids), `/leaderboard`, `/challenges`, `/u/[username]` |

The mobile app can keep working against the same API — it just needs the
Supabase Auth SDK swapped in for the JWT calls, and UUID types.
