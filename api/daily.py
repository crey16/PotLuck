"""Deterministic daily learning content and activity statistics."""
from __future__ import annotations

import datetime
import hashlib
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from api.db import get_connection
from api.deps import current_user_id
from api.learning import answerable_screen_indices, lesson_attempt_score
from api.progress import et_day_start_utc, next_streak, recalc_level, today_et

router = APIRouter()

XP_DAILY_COMPLETE = 15


def daily_content_index(day: datetime.date, pool_size: int) -> int:
    if pool_size <= 0:
        raise ValueError("daily content pool must not be empty")
    digest = hashlib.sha256(day.isoformat().encode()).hexdigest()
    return int(digest, 16) % pool_size


def _ensure_daily_content(cur: Any, day: datetime.date):
    cur.execute(
        """
        select id, date, content_type, lesson_id, scenario_id
        from daily_content where date = %s
        """,
        (day,),
    )
    existing = cur.fetchone()
    if existing is not None:
        return existing

    cur.execute(
        """
        select id from lessons
        where is_active and estimated_time_seconds is not null
          and difficulty between 1 and 3
        order by id
        """
    )
    lesson_ids = [row[0] for row in cur.fetchall()]
    if lesson_ids:
        lesson_id = lesson_ids[daily_content_index(day, len(lesson_ids))]
        content_type = "lesson"
        scenario_id = None
    else:
        cur.execute("select id from scenarios where is_active order by id")
        scenario_ids = [row[0] for row in cur.fetchall()]
        if not scenario_ids:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "no content available for the daily lesson",
            )
        scenario_id = scenario_ids[daily_content_index(day, len(scenario_ids))]
        content_type = "scenario"
        lesson_id = None

    # Concurrent first requests can choose the same deterministic item. The
    # unique date plus ON CONFLICT makes one row win without an error.
    cur.execute(
        """
        insert into daily_content (date, content_type, lesson_id, scenario_id)
        values (%s, %s, %s, %s)
        on conflict (date) do nothing
        """,
        (day, content_type, lesson_id, scenario_id),
    )
    cur.execute(
        """
        select id, date, content_type, lesson_id, scenario_id
        from daily_content where date = %s
        """,
        (day,),
    )
    return cur.fetchone()


def _daily_lesson(cur: Any, lesson_id: int) -> dict[str, Any] | None:
    cur.execute(
        """
        select id, module_id, lesson_type, title, order_index, content_json,
               estimated_time_seconds, difficulty, version, is_active, created_at
        from lessons where id = %s and is_active
        """,
        (lesson_id,),
    )
    row = cur.fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "module_id": row[1],
        "lesson_type": row[2],
        "title": row[3],
        "order_index": row[4],
        "content_json": row[5],
        "estimated_time_seconds": row[6],
        "difficulty": row[7],
        "version": row[8],
        "is_active": row[9],
        "created_at": row[10],
    }


def _daily_scenario(cur: Any, scenario_id: int) -> dict[str, Any] | None:
    cur.execute(
        """
        select id, module_id, skill_tag, difficulty, scenario_json,
               version, is_active, created_at
        from scenarios where id = %s and is_active
        """,
        (scenario_id,),
    )
    row = cur.fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "module_id": row[1],
        "skill_tag": row[2],
        "difficulty": row[3],
        "scenario_json": row[4],
        "version": row[5],
        "is_active": row[6],
        "created_at": row[7],
    }


def _require_completed_daily_item(
    cur: Any,
    user_id: str,
    day: datetime.date,
    content_type: str,
    lesson_id: int | None,
    scenario_id: int | None,
) -> None:
    """Reject bonus claims that have no server-side completion evidence."""
    day_start = et_day_start_utc(day)
    if content_type == "lesson" and lesson_id is not None:
        cur.execute(
            """
            select p.completed_at, l.content_json
            from progress p
            join lessons l on l.id = p.lesson_id and l.is_active
            where p.user_id = %s and p.lesson_id = %s
              and p.status = 'completed'
            """,
            (user_id, lesson_id),
        )
        completion = cur.fetchone()
        if completion is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "complete today's lesson before claiming the daily bonus",
            )
        completed_at, content_json = completion
        if completed_at is not None and completed_at >= day_start:
            return
        required = set(answerable_screen_indices(content_json))
        if not required:
            return
        cur.execute(
            """
            select lesson_screen_index, is_correct
            from attempts
            where user_id = %s and lesson_id = %s
              and lesson_screen_index is not null and created_at >= %s
            order by created_at, id
            """,
            (user_id, lesson_id, day_start),
        )
        _, incomplete = lesson_attempt_score(content_json, cur.fetchall())
        if incomplete:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "replay today's lesson before claiming the daily bonus",
            )
        return

    if content_type == "scenario" and scenario_id is not None:
        cur.execute(
            """
            select 1 from attempts
            where user_id = %s and scenario_id = %s and created_at >= %s
            limit 1
            """,
            (user_id, scenario_id, day_start),
        )
        if cur.fetchone() is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "complete today's scenario before claiming the daily bonus",
            )
        return

    raise HTTPException(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "daily content is invalid",
    )


@router.get("/api/daily")
def get_daily(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    today = today_et()
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                daily = _ensure_daily_content(cur, today)
                if daily is None:
                    raise HTTPException(
                        status.HTTP_503_SERVICE_UNAVAILABLE,
                        "daily content could not be selected",
                    )
                _, day, content_type, lesson_id, scenario_id = daily
                lesson = _daily_lesson(cur, lesson_id) if lesson_id else None
                scenario = _daily_scenario(cur, scenario_id) if scenario_id else None
                cur.execute(
                    """
                    select 1 from user_daily_completions
                    where user_id = %s and date = %s
                    """,
                    (user_id, today),
                )
                is_completed = cur.fetchone() is not None
        except Exception:
            conn.rollback()
            raise
        conn.commit()

    estimated = (
        lesson.get("estimated_time_seconds") or 300
        if lesson is not None
        else 120
    )
    return {
        "date": day,
        "content_type": content_type,
        "lesson": lesson,
        "scenario": scenario,
        "title": "Daily lesson",
        "estimated_time_seconds": estimated,
        "is_completed": is_completed,
        "xp_reward": XP_DAILY_COMPLETE,
    }


@router.post("/api/daily/complete")
def complete_daily(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    today = today_et()
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                daily = _ensure_daily_content(cur, today)
                if daily is None:
                    raise HTTPException(
                        status.HTTP_503_SERVICE_UNAVAILABLE,
                        "daily content could not be selected",
                    )
                _, _, content_type, lesson_id, scenario_id = daily

                cur.execute(
                    """
                    select xp, streak_count, last_active_date
                    from profiles where id = %s for update
                    """,
                    (user_id,),
                )
                profile = cur.fetchone()
                if profile is None:
                    raise HTTPException(status.HTTP_404_NOT_FOUND, "profile not found")
                xp, streak_count, last_active_date = profile

                cur.execute(
                    """
                    select 1 from user_daily_completions
                    where user_id = %s and date = %s
                    """,
                    (user_id, today),
                )
                already_completed = cur.fetchone() is not None
                if already_completed:
                    conn.commit()
                    return {
                        "xp_awarded": 0,
                        "already_completed": True,
                        "total_xp": xp,
                        "level": recalc_level(xp),
                        "streak_count": streak_count,
                    }

                _require_completed_daily_item(
                    cur,
                    user_id,
                    today,
                    content_type,
                    lesson_id,
                    scenario_id,
                )

                content_id = lesson_id or scenario_id
                if content_id is None:
                    raise HTTPException(
                        status.HTTP_503_SERVICE_UNAVAILABLE,
                        "daily content is invalid",
                    )
                cur.execute(
                    """
                    insert into user_daily_completions
                        (user_id, date, content_type, content_id, xp_awarded)
                    values (%s, %s, %s, %s, %s)
                    """,
                    (user_id, today, content_type, content_id, XP_DAILY_COMPLETE),
                )

                new_xp = xp + XP_DAILY_COMPLETE
                new_level = recalc_level(new_xp)
                new_streak, new_last_active = next_streak(
                    last_active_date, streak_count, today
                )
                cur.execute(
                    """
                    insert into user_daily_activity (user_id, date, xp_earned)
                    values (%s, %s, %s)
                    on conflict (user_id, date) do update
                    set xp_earned = user_daily_activity.xp_earned + excluded.xp_earned
                    """,
                    (user_id, today, XP_DAILY_COMPLETE),
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
        "xp_awarded": XP_DAILY_COMPLETE,
        "already_completed": False,
        "total_xp": new_xp,
        "level": new_level,
        "streak_count": new_streak,
    }


@router.get("/api/stats/activity")
def activity_stats(
    start: datetime.date = Query(),
    end: datetime.date = Query(),
    user_id: str = Depends(current_user_id),
) -> list[dict[str, Any]]:
    if start > end:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "start must not be after end"
        )
    if (end - start).days > 366:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "activity range cannot exceed 366 days",
        )
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select date, xp_earned, lessons_completed, scenarios_completed
                from user_daily_activity
                where user_id = %s and date between %s and %s
                order by date
                """,
                (user_id, start, end),
            )
            rows = cur.fetchall()
        conn.commit()
    return [
        {
            "date": row[0],
            "xp_earned": row[1],
            "lessons_completed": row[2],
            "scenarios_completed": row[3],
        }
        for row in rows
    ]
