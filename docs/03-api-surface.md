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

## friends

| Method | Path | Fate |
|---|---|---|
| GET | `/users/search` | **CHANGE** — search `username`, not email. Never expose emails. |
| POST | `/friends/request` | **KEEP** |
| GET | `/friends/requests` | **KEEP** |
| POST | `/friends/respond` | **KEEP** — writes two `friends` rows on accept |
| GET | `/friends` | **KEEP** |

## health

| Method | Path | Fate |
|---|---|---|
| GET | `/health` | **KEEP** — useful for checking cold starts |

---

## New endpoints

### Leaderboards

| Method | Path | Notes |
|---|---|---|
| GET | `/leaderboard?scope=global\|friends&metric=xp\|streak\|accuracy` | Reads the `leaderboard` view; `friends` scope joins `friends` |

`metric=accuracy` needs a rollup from `skill_stats` — consider a materialised
view refreshed by `pg_cron` if it gets slow.

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

### Profiles

| Method | Path | Notes |
|---|---|---|
| GET | `/u/{username}` | Public profile: skill breakdown, streak history, level |
| PATCH | `/profile` | Update display name, bio, avatar, `is_public` |

Respect `is_public`. RLS already enforces it; do not build a bypass.
