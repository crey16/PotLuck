"""FastAPI entrypoint. Vercel finds the Python function at this path and
expects a FastAPI instance literally named `app`.

All routes carry the /api prefix so dev (via the next.config.ts rewrite) and
prod (Vercel's native routing to this function) hit the same paths.
"""
from __future__ import annotations

from typing import Any

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
from psycopg.types.json import Json
from pydantic import BaseModel

from api.db import get_connection
from api.deps import current_user_id
from api.progress import next_streak, recalc_level, today_et

app = FastAPI()

XP_CORRECT_ANSWER = 10


@app.get("/api/health")
def health(db: int = 0) -> Any:
    if not db:
        return {"status": "ok"}

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
            conn.commit()
    except Exception:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "ok", "db": "unreachable"},
        )

    return {"status": "ok", "db": "ok"}


class AttemptIn(BaseModel):
    drill_kind: str
    drill_payload: dict
    answer: str
    is_correct: bool


@app.post("/api/progress/attempts")
def record_attempt(
    body: AttemptIn,
    user_id: str = Depends(current_user_id),
) -> dict:
    xp_earned = XP_CORRECT_ANSWER if body.is_correct else 0
    today = today_et()

    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                # Look up the profile first (locking the row for this
                # transaction) so a missing profile is a clean 404 rather
                # than a foreign-key violation surfaced from the insert below.
                cur.execute(
                    """
                    select username, display_name, xp, streak_count,
                           last_active_date
                    from profiles
                    where id = %s
                    for update
                    """,
                    (user_id,),
                )
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(
                        status.HTTP_404_NOT_FOUND, "profile not found"
                    )
                username, display_name, xp, streak_count, last_active_date = row

                # 1. Insert the attempt. Content-table FKs (lesson_id,
                # scenario_id, table_scenario_id) are null — this attempt
                # came from a client-generated lib/poker drill.
                cur.execute(
                    """
                    insert into attempts
                        (user_id, drill_kind, drill_payload, is_correct,
                         selected_choice_id)
                    values (%s, %s, %s, %s, %s)
                    """,
                    (
                        user_id,
                        body.drill_kind,
                        Json(body.drill_payload),
                        body.is_correct,
                        body.answer,
                    ),
                )

                # 2. XP + level (recalc_level is the one consolidated place
                # level is derived from xp).
                new_xp = xp + xp_earned
                new_level = recalc_level(new_xp)

                # 3. Streak (verbatim port of StackSchool's _update_streak).
                new_streak, new_last_active = next_streak(
                    last_active_date, streak_count, today
                )

                # 4. Daily activity upsert — increment via the SET clause,
                # never read-modify-write.
                cur.execute(
                    """
                    insert into user_daily_activity (user_id, date, xp_earned)
                    values (%s, %s, %s)
                    on conflict (user_id, date) do update
                    set xp_earned = user_daily_activity.xp_earned + excluded.xp_earned
                    """,
                    (user_id, today, xp_earned),
                )

                # 5. Update the profile row and return it.
                cur.execute(
                    """
                    update profiles
                    set xp = %s, level = %s, streak_count = %s,
                        last_active_date = %s
                    where id = %s
                    returning id, username, display_name, xp, level,
                              streak_count, last_active_date
                    """,
                    (new_xp, new_level, new_streak, new_last_active, user_id),
                )
                updated = cur.fetchone()
        except Exception:
            conn.rollback()
            raise
        conn.commit()

    (
        profile_id,
        updated_username,
        updated_display_name,
        updated_xp,
        updated_level,
        updated_streak_count,
        updated_last_active_date,
    ) = updated

    return {
        "id": str(profile_id),
        "username": updated_username,
        "display_name": updated_display_name,
        "xp": updated_xp,
        "level": updated_level,
        "streak_count": updated_streak_count,
        "last_active_date": (
            updated_last_active_date.isoformat()
            if updated_last_active_date
            else None
        ),
        "xp_earned": xp_earned,
    }
