"""M4 learning-path routes and pure lesson/recommendation rules.

Authored content is also read directly from Supabase by Next.js server
components, but these endpoints keep the documented API available to the
mobile client. All progress writes are server-authoritative.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from psycopg.types.json import Json
from pydantic import BaseModel, ConfigDict, Field

from api.db import get_connection
from api.deps import current_user_id
from api.progress import (
    et_day_start_utc,
    is_unsure_choice,
    next_streak,
    recalc_level,
    today_et,
)

router = APIRouter()

CONTENT_VERSION = 1
DEFAULT_LESSON_XP = 10
MAX_LESSON_XP = 100
MIN_RECOMMENDATION_ATTEMPTS = 5


class LessonAttemptIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lesson_id: int = Field(gt=0)
    screen_index: int = Field(ge=0)
    selected_choice_id: str = Field(min_length=1, max_length=256)


class LessonCompleteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lesson_id: int = Field(gt=0)


# Params: (user_id, skill_tag, 1 if correct else 0, 1 if unsure else 0).
# The unsure column arrived with M8.5C; every call site passes it explicitly so
# a new one cannot forget and silently lose the signal.
LESSON_SKILL_STATS_SQL = """
    insert into skill_stats
        (user_id, skill_tag, total_attempts, correct_attempts, unsure_attempts)
    values (%s, %s, 1, %s, %s)
    on conflict (user_id, skill_tag) do update
    set total_attempts   = skill_stats.total_attempts + 1,
        correct_attempts = skill_stats.correct_attempts + excluded.correct_attempts,
        unsure_attempts  = skill_stats.unsure_attempts + excluded.unsure_attempts
"""


def lesson_xp_reward(content_json: Any) -> int:
    """Return a bounded, server-read XP reward from trusted lesson content."""
    if not isinstance(content_json, dict):
        return DEFAULT_LESSON_XP
    reward = content_json.get("xp_reward", DEFAULT_LESSON_XP)
    # bool is an int subclass, but it is never a meaningful content reward.
    if isinstance(reward, bool) or not isinstance(reward, int):
        return DEFAULT_LESSON_XP
    return max(0, min(MAX_LESSON_XP, reward))


def lesson_skill_tags(content_json: Any) -> list[str]:
    """Sanitize and de-duplicate the skill tags attached to a lesson."""
    if not isinstance(content_json, dict):
        return []
    raw = content_json.get("skill_tags")
    if not isinstance(raw, list):
        return []
    tags: list[str] = []
    for value in raw:
        if not isinstance(value, str):
            continue
        tag = value.strip()
        if tag and len(tag) <= 64 and tag not in tags:
            tags.append(tag)
    return tags


def answerable_screen_indices(content_json: Any) -> list[int]:
    """Indices whose authored answers must be saved before completion."""
    if not isinstance(content_json, dict):
        return []
    screens = content_json.get("screens")
    if not isinstance(screens, list):
        return []
    return [
        index
        for index, screen in enumerate(screens)
        if isinstance(screen, dict) and screen.get("type") in {"question", "drill"}
    ]


def lesson_attempt_score(
    content_json: Any, attempts: list[tuple[int, bool]]
) -> tuple[int, list[int]]:
    """Return first-try score and screens that do not satisfy completion.

    Questions require an attempt; drills require at least one correct attempt.
    """
    required = answerable_screen_indices(content_json)
    if not required:
        return 100, []
    required_set = set(required)
    screens = content_json["screens"]
    drill_indices = {
        index
        for index in required
        if isinstance(screens[index], dict) and screens[index].get("type") == "drill"
    }
    first_try: dict[int, bool] = {}
    correct_screens: set[int] = set()
    for screen_index, is_correct in attempts:
        if screen_index not in required_set:
            continue
        if screen_index not in first_try:
            first_try[screen_index] = bool(is_correct)
        if is_correct:
            correct_screens.add(screen_index)
    incomplete = [
        index
        for index in required
        if index not in first_try
        or (index in drill_indices and index not in correct_screens)
    ]
    correct = sum(1 for index in required if first_try.get(index, False))
    # Match JavaScript's Math.round for non-negative percentage values.
    score = (correct * 100 + len(required) // 2) // len(required)
    return score, incomplete


def grade_lesson_screen(
    content_json: Any, screen_index: int, selected_choice_id: str
) -> tuple[bool, list[str]]:
    """Grade one authored question/drill without trusting a client flag.

    Raises ValueError for malformed content or an index that does not point to
    an answerable screen. The route maps that to a 422 response.

    "Not sure" (M8.5C) still validates the screen — a malformed lesson or an
    unanswerable index is an error however the player responded — but is graded
    incorrect without being required to name a choice.
    """
    if not isinstance(content_json, dict):
        raise ValueError("lesson content is invalid")
    screens = content_json.get("screens")
    if not isinstance(screens, list) or screen_index >= len(screens):
        raise ValueError("screen index is invalid")
    screen = screens[screen_index]
    if not isinstance(screen, dict) or screen.get("type") not in {"question", "drill"}:
        raise ValueError("screen is not answerable")
    choices = screen.get("choices")
    if not isinstance(choices, list):
        raise ValueError("screen choices are invalid")
    choice_ids = {
        choice.get("id")
        for choice in choices
        if isinstance(choice, dict) and isinstance(choice.get("id"), str)
    }
    if is_unsure_choice(selected_choice_id):
        return False, lesson_skill_tags(content_json)
    if selected_choice_id not in choice_ids:
        raise ValueError("choice is not present on this screen")
    correct_choice_id = screen.get("correct_choice_id")
    if not isinstance(correct_choice_id, str) or correct_choice_id not in choice_ids:
        raise ValueError("screen answer is invalid")
    return selected_choice_id == correct_choice_id, lesson_skill_tags(content_json)


def difficulty_for_accuracy(correct_attempts: int, total_attempts: int) -> int:
    """Recommendation difficulty from the settled StackSchool thresholds."""
    if total_attempts <= 0:
        return 1
    accuracy = correct_attempts / total_attempts
    if accuracy < 0.40:
        return 1
    if accuracy < 0.75:
        return 2
    return 3


def _lesson_out(row: tuple[Any, ...]) -> dict[str, Any]:
    (
        lesson_id,
        module_id,
        lesson_type,
        title,
        order_index,
        content_json,
        estimated_time_seconds,
        difficulty,
        version,
        is_active,
        created_at,
    ) = row
    return {
        "id": lesson_id,
        "module_id": module_id,
        "lesson_type": lesson_type,
        "title": title,
        "order_index": order_index,
        "content_json": content_json,
        "estimated_time_seconds": estimated_time_seconds,
        "difficulty": difficulty,
        "version": version,
        "is_active": is_active,
        "created_at": created_at,
    }


LESSON_SELECT = """
    select id, module_id, lesson_type, title, order_index, content_json,
           estimated_time_seconds, difficulty, version, is_active, created_at
    from lessons
"""


@router.get("/api/content/version")
def content_version() -> dict[str, int]:
    return {"content_version": CONTENT_VERSION}


@router.get("/api/content/modules")
def list_modules() -> list[dict[str, Any]]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, title, description, order_index, is_active, created_at
                from modules
                where is_active
                order by order_index, id
                """
            )
            rows = cur.fetchall()
        conn.commit()
    return [
        {
            "id": row[0],
            "title": row[1],
            "description": row[2],
            "order_index": row[3],
            "is_active": row[4],
            "created_at": row[5],
        }
        for row in rows
    ]


@router.get("/api/content/lessons")
def list_lessons(module_id: int = Query(gt=0)) -> list[dict[str, Any]]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                LESSON_SELECT
                + " where module_id = %s and is_active order by order_index, id",
                (module_id,),
            )
            rows = cur.fetchall()
        conn.commit()
    return [_lesson_out(row) for row in rows]


def record_lesson_attempt(body: LessonAttemptIn, user_id: str) -> dict[str, Any]:
    """Record and server-grade an authored lesson answer."""
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "select content_json from lessons where id = %s and is_active",
                    (body.lesson_id,),
                )
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(status.HTTP_404_NOT_FOUND, "lesson not found")
                try:
                    is_correct, skill_tags = grade_lesson_screen(
                        row[0], body.screen_index, body.selected_choice_id
                    )
                except ValueError as exc:
                    raise HTTPException(
                        status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)
                    ) from exc

                is_unsure = is_unsure_choice(body.selected_choice_id)
                cur.execute(
                    """
                    insert into attempts
                        (user_id, lesson_id, lesson_screen_index, is_correct,
                         selected_choice_id, response_type)
                    values (%s, %s, %s, %s, %s, %s)
                    returning id, created_at
                    """,
                    (
                        user_id,
                        body.lesson_id,
                        body.screen_index,
                        is_correct,
                        body.selected_choice_id,
                        "unsure" if is_unsure else "answer",
                    ),
                )
                attempt_id, created_at = cur.fetchone()
                for tag in skill_tags:
                    cur.execute(
                        LESSON_SKILL_STATS_SQL,
                        (user_id, tag, 1 if is_correct else 0, 1 if is_unsure else 0),
                    )
        except Exception:
            conn.rollback()
            raise
        conn.commit()

    return {
        "id": attempt_id,
        "lesson_id": body.lesson_id,
        "screen_index": body.screen_index,
        "selected_choice_id": body.selected_choice_id,
        "is_correct": is_correct,
        "response_type": "unsure" if is_unsure else "answer",
        "skill_tags": skill_tags,
        "created_at": created_at,
    }


@router.post("/api/progress/lesson-complete")
def complete_lesson(
    body: LessonCompleteIn,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    today = today_et()

    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "select title, content_json from lessons where id = %s and is_active",
                    (body.lesson_id,),
                )
                lesson = cur.fetchone()
                if lesson is None:
                    raise HTTPException(status.HTTP_404_NOT_FOUND, "lesson not found")
                lesson_title, content_json = lesson

                # The profile lock serializes concurrent completion requests,
                # making the progress check and XP award idempotent together.
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
                profile = cur.fetchone()
                if profile is None:
                    raise HTTPException(status.HTTP_404_NOT_FOUND, "profile not found")
                username, display_name, xp, streak_count, last_active_date = profile

                cur.execute(
                    """
                    select status, attempts_count, best_score
                    from progress
                    where user_id = %s and lesson_id = %s
                    """,
                    (user_id, body.lesson_id),
                )
                existing = cur.fetchone()
                already_completed = existing is not None and existing[0] == "completed"
                xp_earned = 0 if already_completed else lesson_xp_reward(content_json)

                attempt_params: list[Any] = [user_id, body.lesson_id]
                attempt_date_clause = ""
                if already_completed:
                    # A replay must contain a fresh pass through every check;
                    # old attempts cannot be reused to farm streak/daily calls.
                    attempt_date_clause = "and created_at >= %s"
                    attempt_params.append(et_day_start_utc(today))
                cur.execute(
                    f"""
                    select lesson_screen_index, is_correct
                    from attempts
                    where user_id = %s and lesson_id = %s
                      and lesson_screen_index is not null
                      {attempt_date_clause}
                    order by created_at, id
                    """,
                    tuple(attempt_params),
                )
                authoritative_score, missing_screens = lesson_attempt_score(
                    content_json, cur.fetchall()
                )
                if missing_screens:
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        "complete every lesson check before finishing",
                    )

                cur.execute(
                    """
                    insert into progress
                        (user_id, lesson_id, status, completed_at,
                         attempts_count, best_score)
                    values (%s, %s, 'completed', now(), 1, %s)
                    on conflict (user_id, lesson_id) do update
                    set status = 'completed',
                        completed_at = coalesce(progress.completed_at,
                                                excluded.completed_at),
                        attempts_count = progress.attempts_count + 1,
                        best_score = greatest(progress.best_score,
                                              excluded.best_score)
                    """,
                    (user_id, body.lesson_id, authoritative_score),
                )

                new_xp = xp + xp_earned
                new_level = recalc_level(new_xp)
                new_streak, new_last_active = next_streak(
                    last_active_date, streak_count, today
                )

                if not already_completed:
                    cur.execute(
                        """
                        insert into user_daily_activity
                            (user_id, date, xp_earned, lessons_completed)
                        values (%s, %s, %s, 1)
                        on conflict (user_id, date) do update
                        set xp_earned = user_daily_activity.xp_earned + excluded.xp_earned,
                            lessons_completed = user_daily_activity.lessons_completed + 1
                        """,
                        (user_id, today, xp_earned),
                    )

                cur.execute(
                    """
                    update profiles
                    set xp = %s, level = %s, streak_count = %s,
                        last_active_date = %s
                    where id = %s
                    """,
                    (new_xp, new_level, new_streak, new_last_active, user_id),
                )
        except Exception:
            conn.rollback()
            raise
        conn.commit()

    return {
        "lesson_id": body.lesson_id,
        "lesson_title": lesson_title,
        "xp_earned": xp_earned,
        "total_xp": new_xp,
        "level": new_level,
        "streak_count": new_streak,
        "already_completed": already_completed,
        "score": authoritative_score,
    }


@router.get("/api/progress/lessons")
def list_lesson_progress(
    user_id: str = Depends(current_user_id),
) -> list[dict[str, Any]]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select lesson_id, status, completed_at, attempts_count, best_score
                from progress
                where user_id = %s
                order by lesson_id
                """,
                (user_id,),
            )
            rows = cur.fetchall()
        conn.commit()
    return [
        {
            "lesson_id": row[0],
            "status": row[1],
            "completed_at": row[2],
            "attempts_count": row[3],
            "best_score": row[4],
        }
        for row in rows
    ]


def _next_unfinished_lesson(cur: Any, user_id: str, skill_tag: str | None = None):
    params: list[Any] = [user_id]
    skill_clause = ""
    if skill_tag is not None:
        skill_clause = "and l.content_json -> 'skill_tags' @> %s::jsonb"
        params.append(Json([skill_tag]))
    cur.execute(
        f"""
        select l.id, l.module_id, l.title, l.lesson_type,
               l.estimated_time_seconds, l.difficulty
        from lessons l
        join modules m on m.id = l.module_id and m.is_active
        where l.is_active
          and not exists (
            select 1 from progress p
            where p.user_id = %s and p.lesson_id = l.id
              and p.status = 'completed'
          )
          {skill_clause}
        order by m.order_index, l.order_index, l.id
        limit 1
        """,
        tuple(params),
    )
    return cur.fetchone()


def _lesson_recommendation(row: tuple[Any, ...], reason: str, skill_tag: str | None):
    return {
        "type": "lesson",
        "lesson_id": row[0],
        "module_id": row[1],
        "lesson": {
            "id": row[0],
            "module_id": row[1],
            "title": row[2],
            "lesson_type": row[3],
            "estimated_time_seconds": row[4],
            "difficulty": row[5],
        },
        "scenario_id": None,
        "reason": reason,
        "skill_tag": skill_tag,
        "difficulty": None,
    }


@router.get("/api/recommendations/next")
def next_recommendation(
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select skill_tag, correct_attempts, total_attempts
                from skill_stats
                where user_id = %s and total_attempts >= %s
                order by correct_attempts::numeric / nullif(total_attempts, 0),
                         skill_tag
                limit 1
                """,
                (user_id, MIN_RECOMMENDATION_ATTEMPTS),
            )
            weakest = cur.fetchone()

            if weakest is not None:
                skill_tag, correct_attempts, total_attempts = weakest
                difficulty = difficulty_for_accuracy(correct_attempts, total_attempts)
                lesson = _next_unfinished_lesson(cur, user_id, skill_tag)
                if lesson is not None:
                    conn.commit()
                    return _lesson_recommendation(
                        lesson,
                        f"Build your {skill_tag.replace('_', ' ')}",
                        skill_tag,
                    )

                # Only return a scenario when matching content really exists.
                cur.execute(
                    """
                    select id, module_id, skill_tag, difficulty
                    from scenarios
                    where is_active and skill_tag = %s and difficulty = %s
                    order by id
                    limit 1
                    """,
                    (skill_tag, difficulty),
                )
                scenario = cur.fetchone()
                if scenario is not None:
                    conn.commit()
                    return {
                        "type": "scenario",
                        "lesson_id": None,
                        "module_id": scenario[1],
                        "lesson": None,
                        "scenario_id": scenario[0],
                        "reason": f"Practice your {skill_tag.replace('_', ' ')}",
                        "skill_tag": skill_tag,
                        "difficulty": scenario[3],
                    }

            lesson = _next_unfinished_lesson(cur, user_id)
            if lesson is not None:
                conn.commit()
                return _lesson_recommendation(
                    lesson,
                    "Continue the learning path",
                    weakest[0] if weakest is not None else None,
                )

            cur.execute(
                """
                select id, module_id, skill_tag, difficulty
                from scenarios
                where is_active
                order by case when difficulty = 2 then 0 else 1 end, id
                limit 1
                """
            )
            scenario = cur.fetchone()
        conn.commit()

    if scenario is not None:
        return {
            "type": "scenario",
            "lesson_id": None,
            "module_id": scenario[1],
            "lesson": None,
            "scenario_id": scenario[0],
            "reason": "Keep sharpening your decisions",
            "skill_tag": scenario[2],
            "difficulty": scenario[3],
        }
    return {
        "type": "none",
        "lesson_id": None,
        "module_id": None,
        "lesson": None,
        "scenario_id": None,
        "reason": "Learning content is not available yet",
        "skill_tag": None,
        "difficulty": None,
    }
