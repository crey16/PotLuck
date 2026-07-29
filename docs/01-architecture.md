# Architecture

## The shape

```
                    ┌──────────────────────────────────────────┐
                    │              Vercel project              │
   Browser ────────▶│  Next.js App Router (React, TypeScript)  │
        │           │    app/, components/, lib/poker/         │
        │           ├──────────────────────────────────────────┤
        │           │  FastAPI as a Vercel Python Function     │
        │  /api/*  ─┼─▶  api/index.py  (exports `app`)         │
        │           └──────────────────────────────────────────┘
        │                            │
        │                            ▼
        │                  ┌───────────────────┐
        └─────────────────▶│     Supabase      │
       auth + realtime     │  Postgres + Auth  │
                           │  + Realtime + RLS │
                           └───────────────────┘
```

Three consumers talk to Supabase, and which one you use matters:

1. **Browser → Supabase directly** (anon key + RLS). Auth, realtime subscriptions,
   and simple reads of the user's own data. RLS is the security boundary.
2. **Next.js server components → Supabase** (user's JWT). Page data that should
   be server-rendered. Still under RLS.
3. **FastAPI → Supabase** (service role key, pooled connection). Anything with
   real logic: scoring, XP/streak updates, recommendations, challenge creation.
   This bypasses RLS, so **the API must check `auth.uid()` itself** — see below.

## Why FastAPI stays

The alternative was rewriting 30 endpoints in TypeScript. Not worth it: the
logic is tested, the scoring and recommendation rules are subtle, and Vercel now
deploys FastAPI natively. Vercel looks for a `FastAPI` instance named `app` at
`api/index.py` (among other paths) and turns the whole app into one Function.

### Constraints of the Python runtime on Vercel

| Constraint | Impact here | Mitigation |
|---|---|---|
| **No WebSockets at all** | Can't push live leaderboard updates from FastAPI | Supabase Realtime, subscribed from the browser |
| 10s timeout (free) / 60s (Pro) | None — all endpoints are simple CRUD | — |
| 300–800ms cold starts | Noticeable on first request | Acceptable for this audience; Fluid compute keeps warm instances under load |
| No background workers | Streak/daily rollups can't be queued | They already run request-time; use Supabase `pg_cron` for anything scheduled |
| Connection pooling breaks at scale | Serverless opens too many PG connections | Use Supabase's **pooler** connection string (port 6543), not the direct one |
| Ephemeral filesystem | No local file writes | Supabase Storage if you ever need uploads |

If you later need WebSockets, long jobs, or no cold starts, the escape hatch is
moving `api/` to Railway or Fly.io unchanged — it's a normal ASGI app. Nothing in
the design assumes Vercel.

## Auth flow

Supabase Auth issues the JWT. The browser holds the session; the server verifies.

```
1. Browser signs in via Supabase Auth (email+password, Google, or magic link).
2. Supabase returns a session JWT. @supabase/ssr stores it in cookies.
3. Next.js server components read the session from cookies.
4. Calls to /api/* forward the JWT in the Authorization header.
5. FastAPI verifies the JWT signature against Supabase's JWKS and extracts `sub`
   — that is the user's UUID. It NEVER trusts a user id from the request body.
```

FastAPI verification sketch (replaces the whole of `app/auth.py` in StackSchool):

```python
# api/deps.py
import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

_jwks = PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json")
_bearer = HTTPBearer()

def current_user_id(cred: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    try:
        key = _jwks.get_signing_key_from_jwt(cred.credentials).key
        claims = jwt.decode(key=key, jwt=cred.credentials,
                            algorithms=["ES256", "RS256"], audience="authenticated")
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")
    return claims["sub"]          # uuid string
```

Everything that was `current_user: User = Depends(get_current_user)` becomes
`user_id: str = Depends(current_user_id)` plus a profile lookup when you need
xp/level/streak.

## Realtime

Supabase Realtime replaces the WebSocket capability Vercel lacks. Subscribe from
a client component:

```ts
supabase.channel('leaderboard')
  .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'profiles', filter: 'is_public=eq.true' },
      (payload) => { /* update the row in place */ })
  .subscribe();
```

Realtime respects RLS, so a user only receives rows they're allowed to read.

## Where the poker logic lives

**In TypeScript, on the client** (`lib/poker/`). Deliberate:

- Drills need to generate a spot, evaluate an answer, and explain it instantly.
  A round trip per hand would make the app feel dead.
- Spot generation uses rejection sampling — thousands of evaluations per spot.
  That's a few milliseconds locally and a terrible thing to do in a 10s serverless
  function.
- The math is not a secret. There is nothing to protect by hiding it.

The server records **outcomes** (`attempts` rows with `drill_kind` and
`drill_payload`), not the generation. `drill_payload` freezes the spot so results
stay reproducible and challenges can replay identical hands to both players.

If you ever need server-authoritative scoring (ranked ladders, prizes), the port
back to Python is mechanical — but do not do it speculatively.
