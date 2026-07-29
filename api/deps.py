"""JWT verification dependency (Supabase Auth JWKS).

Verifies the bearer token's signature against Supabase's JWKS endpoint and
returns the verified `sub` claim (the user's UUID). Never trusts a user id
from the request body — this is the only source of identity for mutating
endpoints.
"""
from __future__ import annotations

import os

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

# Accept NEXT_PUBLIC_SUPABASE_URL as a fallback so one .env.local serves both
# the Next.js dev server and this API.
_SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get(
    "NEXT_PUBLIC_SUPABASE_URL"
)

# auto_error=False: a missing Authorization header should surface as our own
# 401 below, not FastAPI's default 403 for HTTPBearer.
_bearer = HTTPBearer(auto_error=False)

_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    """Cached at module level (cold-start friendly). Constructing a
    PyJWKClient does not itself make a network call; the JWKS fetch only
    happens on `get_signing_key_from_jwt`, and is cached by the client."""
    global _jwks_client
    if _jwks_client is None:
        if not _SUPABASE_URL:
            raise RuntimeError(
                "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is not set"
            )
        _jwks_client = PyJWKClient(
            f"{_SUPABASE_URL}/auth/v1/.well-known/jwks.json"
        )
    return _jwks_client


def current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")

    try:
        client = _get_jwks_client()
        signing_key = client.get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
        )
    except Exception as exc:
        # Malformed token, unknown kid, expired, bad signature, wrong
        # audience, or JWKS unreachable — all collapse to 401. Details are
        # not leaked to the client.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token") from exc

    return claims["sub"]
