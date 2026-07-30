"""Authored scenario and table-scenario routes for M4."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from api.db import get_connection
from api.deps import current_user_id
from api.learning import LESSON_SKILL_STATS_SQL, difficulty_for_accuracy
from api.progress import et_day_start_utc, next_streak, recalc_level, today_et

router = APIRouter()

XP_SCENARIO_CORRECT = 5
XP_SCENARIO_ACCEPTABLE = 2
RECENT_SCENARIO_LOOKBACK = 5
MIN_ADAPTIVE_ATTEMPTS = 5


class ScenarioSubmitIn(BaseModel):
    scenario_id: int = Field(gt=0)
    selected_choice_id: str = Field(min_length=1, max_length=256)


def scenario_xp(is_correct: bool, is_acceptable: bool, already_attempted: bool) -> int:
    if already_attempted:
        return 0
    if is_correct:
        return XP_SCENARIO_CORRECT
    if is_acceptable:
        return XP_SCENARIO_ACCEPTABLE
    return 0


def _scenario_out(row: tuple[Any, ...]) -> dict[str, Any]:
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


SCENARIO_SELECT = """
    select id, module_id, skill_tag, difficulty, scenario_json,
           version, is_active, created_at
    from scenarios
"""


@router.get("/api/content/scenarios")
def list_scenarios(module_id: int = Query(gt=0)) -> list[dict[str, Any]]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                SCENARIO_SELECT
                + " where module_id = %s and is_active order by difficulty, id",
                (module_id,),
            )
            rows = cur.fetchall()
        conn.commit()
    return [_scenario_out(row) for row in rows]


def _weakest_skill(cur: Any, user_id: str):
    cur.execute(
        """
        select skill_tag, correct_attempts, total_attempts
        from skill_stats
        where user_id = %s and total_attempts >= %s
        order by correct_attempts::numeric / nullif(total_attempts, 0), skill_tag
        limit 1
        """,
        (user_id, MIN_ADAPTIVE_ATTEMPTS),
    )
    return cur.fetchone()


def _recent_scenario_ids(cur: Any, user_id: str) -> list[int]:
    cur.execute(
        """
        select scenario_id
        from attempts
        where user_id = %s and scenario_id is not null
        order by created_at desc, id desc
        limit %s
        """,
        (user_id, RECENT_SCENARIO_LOOKBACK),
    )
    return [row[0] for row in cur.fetchall()]


def _pick_scenario(
    cur: Any,
    module_id: int | None,
    difficulty: int,
    skill_tag: str | None,
    exclude_ids: list[int],
):
    """Progressive fallback, keeping the reference implementation's order."""
    base_clauses = ["is_active"]
    base_params: list[Any] = []
    if module_id is not None:
        base_clauses.append("module_id = %s")
        base_params.append(module_id)

    def run(extra: list[str], params: list[Any], exclude: bool = True):
        clauses = [*base_clauses, *extra]
        values = [*base_params, *params]
        if exclude and exclude_ids:
            clauses.append("not (id = any(%s))")
            values.append(exclude_ids)
        cur.execute(
            SCENARIO_SELECT
            + " where "
            + " and ".join(clauses)
            + " order by random() limit 1",
            tuple(values),
        )
        return cur.fetchone()

    if skill_tag:
        row = run(["skill_tag = %s", "difficulty = %s"], [skill_tag, difficulty])
        if row is not None:
            return row
        row = run(["skill_tag = %s"], [skill_tag])
        if row is not None:
            return row
    row = run(["difficulty = %s"], [difficulty])
    if row is not None:
        return row
    row = run([], [])
    if row is not None:
        return row
    return run([], [], exclude=False)


@router.get("/api/scenarios/recommendation")
def scenario_recommendation(
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            weakest = _weakest_skill(cur, user_id)
        conn.commit()
    if weakest is None:
        return {
            "recommended_skill_tag": None,
            "recommended_difficulty": 1,
            "reason": "Play a few hands to unlock personalized practice",
        }
    skill_tag, correct, total = weakest
    difficulty = difficulty_for_accuracy(correct, total)
    accuracy = round((correct / total) * 100)
    return {
        "recommended_skill_tag": skill_tag,
        "recommended_difficulty": difficulty,
        "reason": f"Practice {skill_tag.replace('_', ' ')} ({accuracy}% accuracy)",
    }


@router.get("/api/scenarios/random")
def random_scenario(
    scenario_id: int | None = Query(default=None, gt=0),
    module_id: int | None = Query(default=None, gt=0),
    difficulty: int | None = Query(default=None, ge=1, le=3),
    skill_tag: str | None = Query(default=None, min_length=1, max_length=64),
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if scenario_id is not None:
                cur.execute(
                    SCENARIO_SELECT + " where id = %s and is_active",
                    (scenario_id,),
                )
                row = cur.fetchone()
                conn.commit()
                if row is None:
                    raise HTTPException(status.HTTP_404_NOT_FOUND, "scenario not found")
                return _scenario_out(row)
            recent = _recent_scenario_ids(cur, user_id)
            target_skill = skill_tag
            target_difficulty = difficulty
            if target_skill is None and target_difficulty is None:
                weakest = _weakest_skill(cur, user_id)
                if weakest is None:
                    target_difficulty = 1
                else:
                    target_skill = weakest[0]
                    target_difficulty = difficulty_for_accuracy(weakest[1], weakest[2])
            if target_difficulty is None:
                target_difficulty = 1
            row = _pick_scenario(
                cur, module_id, target_difficulty, target_skill, recent
            )
        conn.commit()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no matching scenario found")
    return _scenario_out(row)


def _lock_profile(cur: Any, user_id: str):
    cur.execute(
        """
        select username, display_name, xp, streak_count, last_active_date
        from profiles where id = %s for update
        """,
        (user_id,),
    )
    profile = cur.fetchone()
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "profile not found")
    return profile


def _update_profile_and_activity(
    cur: Any,
    user_id: str,
    profile: tuple[Any, ...],
    xp_awarded: int,
    scenarios_delta: int,
) -> tuple[int, int, int]:
    _, _, xp, streak_count, last_active_date = profile
    today = today_et()
    new_xp = xp + xp_awarded
    new_level = recalc_level(new_xp)
    new_streak, new_last_active = next_streak(last_active_date, streak_count, today)
    cur.execute(
        """
        insert into user_daily_activity
            (user_id, date, xp_earned, scenarios_completed)
        values (%s, %s, %s, %s)
        on conflict (user_id, date) do update
        set xp_earned = user_daily_activity.xp_earned + excluded.xp_earned,
            scenarios_completed = user_daily_activity.scenarios_completed
                                  + excluded.scenarios_completed
        """,
        (user_id, today, xp_awarded, scenarios_delta),
    )
    cur.execute(
        """
        update profiles
        set xp = %s, level = %s, streak_count = %s, last_active_date = %s
        where id = %s
        """,
        (new_xp, new_level, new_streak, new_last_active, user_id),
    )
    return new_xp, new_level, new_streak


@router.post("/api/scenarios/submit")
def submit_scenario(
    body: ScenarioSubmitIn,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    today = today_et()
    day_start = et_day_start_utc(today)
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select skill_tag, scenario_json
                    from scenarios where id = %s and is_active
                    """,
                    (body.scenario_id,),
                )
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(status.HTTP_404_NOT_FOUND, "scenario not found")
                skill_tag, scenario_json = row
                evaluation = (
                    scenario_json.get("evaluation", {})
                    if isinstance(scenario_json, dict)
                    else {}
                )
                correct_choice_id = evaluation.get("correct_choice_id")
                acceptable_ids = evaluation.get("acceptable_choice_ids") or []
                choices = scenario_json.get("choices", [])
                choice_ids = {
                    choice.get("id") for choice in choices if isinstance(choice, dict)
                }
                if body.selected_choice_id not in choice_ids:
                    raise HTTPException(
                        status.HTTP_422_UNPROCESSABLE_ENTITY,
                        "choice is not present on this scenario",
                    )
                is_correct = body.selected_choice_id == correct_choice_id
                is_acceptable = body.selected_choice_id in acceptable_ids

                profile = _lock_profile(cur, user_id)
                cur.execute(
                    """
                    select 1 from attempts
                    where user_id = %s and scenario_id = %s and created_at >= %s
                    limit 1
                    """,
                    (user_id, body.scenario_id, day_start),
                )
                already_attempted = cur.fetchone() is not None
                xp_awarded = scenario_xp(
                    is_correct, is_acceptable, already_attempted
                )

                cur.execute(
                    """
                    insert into attempts
                        (user_id, scenario_id, is_correct, selected_choice_id)
                    values (%s, %s, %s, %s)
                    """,
                    (
                        user_id,
                        body.scenario_id,
                        is_correct or is_acceptable,
                        body.selected_choice_id,
                    ),
                )
                cur.execute(
                    LESSON_SKILL_STATS_SQL,
                    (user_id, skill_tag, 1 if (is_correct or is_acceptable) else 0),
                )
                total_xp, level, streak = _update_profile_and_activity(
                    cur, user_id, profile, xp_awarded, 1
                )
        except Exception:
            conn.rollback()
            raise
        conn.commit()

    return {
        "is_correct": is_correct,
        "is_acceptable": is_acceptable,
        "xp_awarded": xp_awarded,
        "correct_choice_id": correct_choice_id,
        "explanation": scenario_json.get("explanation", ""),
        "rule_of_thumb": scenario_json.get("rule_of_thumb", ""),
        "total_xp": total_xp,
        "level": level,
        "streak_count": streak,
    }


@router.get("/api/scenarios/skill-stats")
def skill_stats(user_id: str = Depends(current_user_id)) -> list[dict[str, Any]]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select skill_tag, total_attempts, correct_attempts
                from skill_stats where user_id = %s order by skill_tag
                """,
                (user_id,),
            )
            rows = cur.fetchall()
        conn.commit()
    return [
        {
            "skill_tag": row[0],
            "total_attempts": row[1],
            "correct_attempts": row[2],
        }
        for row in rows
    ]


TABLE_SCENARIO_SELECT = """
    select id, module_id, difficulty, skill_tag, street, prompt_title,
           situation_json, choices_json, created_at
    from table_scenarios
"""


def _table_scenario_out(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": row[0],
        "module_id": row[1],
        "difficulty": row[2],
        "skill_tag": row[3],
        "street": row[4],
        "prompt_title": row[5],
        "situation": row[6],
        "choices": row[7],
        "created_at": row[8],
    }


@router.get("/api/table-scenarios/random")
def random_table_scenario(
    module_id: int | None = Query(default=None, gt=0),
    difficulty: int | None = Query(default=None, ge=1, le=3),
    skill_tag: str | None = Query(default=None, min_length=1, max_length=64),
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    del user_id  # Auth is required; content selection itself is not user-specific yet.
    clauses = ["is_active"]
    params: list[Any] = []
    if module_id is not None:
        clauses.append("module_id = %s")
        params.append(module_id)
    if difficulty is not None:
        clauses.append("difficulty = %s")
        params.append(difficulty)
    if skill_tag is not None:
        clauses.append("skill_tag = %s")
        params.append(skill_tag)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                TABLE_SCENARIO_SELECT
                + " where "
                + " and ".join(clauses)
                + " order by random() limit 1",
                tuple(params),
            )
            row = cur.fetchone()
        conn.commit()
    if row is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "no matching table scenario found"
        )
    return _table_scenario_out(row)


@router.post("/api/table-scenarios/submit")
def submit_table_scenario(
    body: ScenarioSubmitIn,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    day_start = et_day_start_utc(today_et())
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select skill_tag, choices_json, correct_choice_id,
                           acceptable_choice_ids, explanation, rule_of_thumb
                    from table_scenarios where id = %s and is_active
                    """,
                    (body.scenario_id,),
                )
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(
                        status.HTTP_404_NOT_FOUND, "table scenario not found"
                    )
                (
                    skill_tag,
                    choices,
                    correct_choice_id,
                    acceptable_ids,
                    explanation,
                    rule_of_thumb,
                ) = row
                choice_ids = {
                    choice.get("id") for choice in choices if isinstance(choice, dict)
                }
                if body.selected_choice_id not in choice_ids:
                    raise HTTPException(
                        status.HTTP_422_UNPROCESSABLE_ENTITY,
                        "choice is not present on this table scenario",
                    )
                is_correct = body.selected_choice_id == correct_choice_id
                is_acceptable = body.selected_choice_id in (acceptable_ids or [])

                profile = _lock_profile(cur, user_id)
                cur.execute(
                    """
                    select 1 from attempts
                    where user_id = %s and table_scenario_id = %s
                      and created_at >= %s
                    limit 1
                    """,
                    (user_id, body.scenario_id, day_start),
                )
                already_attempted = cur.fetchone() is not None
                xp_awarded = scenario_xp(
                    is_correct, is_acceptable, already_attempted
                )
                cur.execute(
                    """
                    insert into attempts
                        (user_id, table_scenario_id, is_correct, selected_choice_id)
                    values (%s, %s, %s, %s)
                    """,
                    (
                        user_id,
                        body.scenario_id,
                        is_correct or is_acceptable,
                        body.selected_choice_id,
                    ),
                )
                cur.execute(
                    LESSON_SKILL_STATS_SQL,
                    (user_id, skill_tag, 1 if (is_correct or is_acceptable) else 0),
                )
                total_xp, level, streak = _update_profile_and_activity(
                    cur, user_id, profile, xp_awarded, 1
                )
        except Exception:
            conn.rollback()
            raise
        conn.commit()

    return {
        "is_correct": is_correct,
        "is_acceptable": is_acceptable,
        "xp_awarded": xp_awarded,
        "correct_choice_id": correct_choice_id,
        "explanation": explanation,
        "rule_of_thumb": rule_of_thumb,
        "total_xp": total_xp,
        "level": level,
        "streak_count": streak,
    }
