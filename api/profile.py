"""Own-profile editing: display name, bio, and the is_public switch.

Username is identity and cannot change here; xp/level/streak are owned by
the progress endpoints. `extra="forbid"` makes any attempt a 422.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from api.db import get_connection
from api.deps import current_user_id

router = APIRouter()


class ProfilePatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, max_length=40)
    bio: str | None = Field(default=None, max_length=280)
    is_public: bool | None = None

    @field_validator("display_name")
    @classmethod
    def _trim_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("display name must not be blank")
        if len(trimmed) > 40:
            raise ValueError("display name must be at most 40 characters")
        return trimmed


def patch_columns(patch: ProfilePatchIn) -> tuple[list[str], list[Any]]:
    """Parameterized SET fragments for exactly the provided fields.

    An empty-string bio clears it (stored as null). Raises ValueError when
    nothing was provided — the endpoint turns that into a 422.
    """
    provided = patch.model_dump(exclude_unset=True)
    if not provided:
        raise ValueError("no fields to update")
    cols: list[str] = []
    values: list[Any] = []
    if "display_name" in provided:
        cols.append("display_name = %s")
        values.append(provided["display_name"])
    if "bio" in provided:
        cols.append("bio = %s")
        values.append(provided["bio"] or None)
    if "is_public" in provided:
        cols.append("is_public = %s")
        values.append(provided["is_public"])
    return cols, values


@router.patch("/api/profile")
def update_profile(
    body: ProfilePatchIn, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    try:
        cols, values = patch_columns(body)
    except ValueError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "no fields to update"
        )
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    update profiles set {", ".join(cols)}
                    where id = %s
                    returning id, username, display_name, bio, is_public,
                              xp, level, streak_count
                    """,
                    (*values, user_id),
                )
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(
                        status.HTTP_404_NOT_FOUND, "profile not found"
                    )
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return {
        "id": str(row[0]),
        "username": row[1],
        "display_name": row[2],
        "bio": row[3],
        "is_public": row[4],
        "xp": row[5],
        "level": row[6],
        "streak_count": row[7],
    }
