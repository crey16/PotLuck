"""FastAPI entrypoint. Vercel finds the Python function at this path and
expects a FastAPI instance literally named `app`.

All routes carry the /api prefix so dev (via the next.config.ts rewrite) and
prod (Vercel's native routing to this function) hit the same paths.
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from api import observability
from api.db import get_connection
from api.deps import current_user_id
from api.daily import router as daily_router
from api.friends import router as friends_router
from api.games import router as games_router
from api.profile import router as profile_router
from api.play import router as play_router
from api.placement import (
    ASSESSMENT_VERSION as PLACEMENT_ASSESSMENT_VERSION,
    GENERATOR_VERSION as PLACEMENT_GENERATOR_VERSION,
    router as placement_router,
)
from api.learning import (
    LessonAttemptIn,
    record_lesson_attempt,
    router as learning_router,
)
from api.progress import graded_correct, next_streak, recalc_level, today_et
from api.scenarios import router as scenarios_router
from api.skills import DRILL_KINDS, skill_tag_for

app = FastAPI()
# Installed before the routers so it wraps every one of them (M8.8A). Starlette
# runs middleware outermost-first, so this is also the layer that sees the true
# request duration including FastAPI's own routing and validation.
observability.install(app)
app.include_router(learning_router)
app.include_router(scenarios_router)
app.include_router(daily_router)
app.include_router(friends_router)
app.include_router(games_router)
app.include_router(profile_router)
app.include_router(play_router)
app.include_router(placement_router)

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
    drill_kind: Literal[
        "outs", "rule24", "potodds", "decision", "implied",
        "ev", "bluff", "concepts", "preflop", "pushfold", "play",
    ]
    drill_payload: dict
    answer: str = Field(max_length=256)
    is_correct: bool
    # M8.5C.  Optional so an older client keeps working; absent means the
    # player committed to a choice, which is what every pre-M8.5 attempt was.
    response_type: Literal["answer", "unsure"] = "answer"


SKILL_STATS_SQL = """
    insert into skill_stats
        (user_id, skill_tag, total_attempts, correct_attempts, unsure_attempts)
    values (%s, %s, 1, %s, %s)
    on conflict (user_id, skill_tag) do update
    set total_attempts   = skill_stats.total_attempts + 1,
        correct_attempts = skill_stats.correct_attempts + excluded.correct_attempts,
        unsure_attempts  = skill_stats.unsure_attempts + excluded.unsure_attempts
"""

# Must equal WINDOW_SIZE in lib/drill/difficulty.ts. The client slices the
# window it receives to its own WINDOW_SIZE, so if these drift the server
# returns one length while the client assumes another — silently truncating or
# under-filling the window with no error anywhere. test_progress.py asserts the
# SQL against this constant, and test_drill_kinds_match_typescript.py pins it
# against the TypeScript value.
DRILL_WINDOW_SIZE = 10

# `response_type = 'answer'` mirrors lib/drill/difficulty.ts::pushOutcome: an
# unsure attempt never enters the adaptive-difficulty window, so it can neither
# demote a drill nor be farmed for easier questions. If this filter and that
# function ever disagree, difficulty silently changes on reload — the seeded
# window would carry rows the live session dropped.
DRILL_STATE_SQL = f"""
    select drill_kind, is_correct
    from (
      select drill_kind, is_correct,
             row_number() over (partition by drill_kind
                                order by created_at desc, id desc) as rn
      from attempts
      where user_id = %s and drill_kind is not null
        and response_type = 'answer'
    ) t
    where rn <= {DRILL_WINDOW_SIZE}
    order by drill_kind, rn desc
"""


@app.post("/api/progress/attempts")
def record_attempt(
    body: AttemptIn | LessonAttemptIn,
    user_id: str = Depends(current_user_id),
) -> dict:
    if isinstance(body, LessonAttemptIn):
        return record_lesson_attempt(body, user_id)

    # M8 play history is server-authoritative.  Keep ``play`` in AttemptIn so
    # the shared drill-kind vocabulary and old rows remain readable, but never
    # accept a new client-graded/unlinked play attempt through the generic
    # endpoint.  The decision route derives the grade and writes its linked
    # attempt atomically.
    if body.drill_kind == "play":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "submit play decisions through /api/play/hands/{hand_id}/decisions",
        )

    # "Not sure" is never right, whatever the client claims (M8.5C).
    is_unsure = body.response_type == "unsure"
    is_correct = graded_correct(body.is_correct, body.response_type)

    xp_earned = XP_CORRECT_ANSWER if is_correct else 0
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
                         selected_choice_id, response_type)
                    values (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        user_id,
                        body.drill_kind,
                        Json(body.drill_payload),
                        is_correct,
                        body.answer,
                        body.response_type,
                    ),
                )

                # 1b. Skill stats. The tag is derived server-side from
                # drill_kind so the client cannot report the wrong one.
                cur.execute(
                    SKILL_STATS_SQL,
                    (
                        user_id,
                        skill_tag_for(body.drill_kind),
                        1 if is_correct else 0,
                        1 if is_unsure else 0,
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


@app.get("/api/progress/drill-state")
def drill_state(user_id: str = Depends(current_user_id)) -> Any:
    """Per-drill rolling windows so adaptive difficulty survives a reload.

    Read-only and fail-soft by design: the client treats any error as "no
    history", which simply starts every drill at level 1.
    """
    windows: dict[str, list[bool]] = {kind: [] for kind in DRILL_KINDS}
    placement_levels: dict[str, int] = {}

    # No try/except + rollback here, unlike record_attempt above: this
    # handler only reads (one select, then a commit to close the
    # transaction cleanly). Read-only means no partial-write risk, so there
    # is nothing to roll back. If this function ever grows a write, add the
    # same try/except + rollback guard record_attempt uses.
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(DRILL_STATE_SQL, (user_id,))
            for kind, is_correct in cur.fetchall():
                if kind in windows:
                    windows[kind].append(bool(is_correct))

            # M8.5B: the starting difficulty the placement assessment implies.
            # Applied by the client as a FLOOR under the history-derived level,
            # so it only ever saves a new player from grinding level 1 and
            # never pulls an experienced one back down.
            #
            # Both versions must match today's. A placement scored by different
            # rules or dealt by different generators measured something else,
            # and silently reinterpreting it is the exact failure the stored
            # versions exist to prevent — so an outdated result simply stops
            # applying rather than being reinterpreted.
            cur.execute(
                """
                select levels from placement_assessments
                where user_id = %s and status = 'completed'
                  and assessment_version = %s and generator_version = %s
                order by started_at desc, id desc
                limit 1
                """,
                (user_id, PLACEMENT_ASSESSMENT_VERSION, PLACEMENT_GENERATOR_VERSION),
            )
            row = cur.fetchone()
            if row and isinstance(row[0], dict):
                placement_levels = {
                    kind: level
                    for kind, level in row[0].items()
                    if kind in windows and isinstance(level, int) and 1 <= level <= 3
                }
        conn.commit()

    return {"windows": windows, "placement_levels": placement_levels}
