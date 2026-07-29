"""Tests for the JWT verification dependency.

No network calls: a missing Authorization header or a malformed token fails
during local parsing (before any JWKS fetch is attempted), so these tests
run with no reachable Supabase project and no DATABASE_URL/SUPABASE_URL set.
"""
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from api.deps import current_user_id

_app = FastAPI()


@_app.get("/whoami")
def _whoami(user_id: str = Depends(current_user_id)) -> dict:
    return {"user_id": user_id}


client = TestClient(_app)


def test_missing_token_is_401() -> None:
    response = client.get("/whoami")
    assert response.status_code == 401


def test_garbage_token_is_401() -> None:
    response = client.get("/whoami", headers={"Authorization": "Bearer not-a-real-jwt"})
    assert response.status_code == 401


def test_garbage_token_with_jwt_shape_is_401() -> None:
    # Three dot-separated segments (superficially JWT-shaped) but not valid
    # base64/JSON — must still fail locally, no network.
    response = client.get(
        "/whoami", headers={"Authorization": "Bearer aaaa.bbbb.cccc"}
    )
    assert response.status_code == 401


def test_wrong_auth_scheme_is_401() -> None:
    response = client.get("/whoami", headers={"Authorization": "Basic aaaa"})
    assert response.status_code == 401
