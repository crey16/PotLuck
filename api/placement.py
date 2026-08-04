"""M8.5B new-user placement assessment.

Placement is deliberately NOT practice:

  * it writes nothing to ``attempts``,
  * it awards no XP and touches no streak or daily-activity row,
  * it never lands in ``skill_stats``.

So a player being placed cannot inflate their own accuracy, XP or streak, and
the coaching aggregates M11 will build stay free of nine questions answered
before the player knew what any of them meant. The XP rule is stated here
rather than falling out of the generic attempt path, which is exactly what
would have happened if placement had reused ``/progress/attempts``.

The scoring rules below mirror ``lib/placement/blueprint.ts``;
``test_placement_matches_typescript.py`` pins the two together.
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg.types.json import Json
from pydantic import BaseModel, ConfigDict, Field

from api.db import get_connection
from api.deps import current_user_id
from api.skills import skill_tag_for

router = APIRouter()

# Must equal ASSESSMENT_VERSION / GENERATOR_VERSION / PROBE_LEVEL in
# lib/placement/blueprint.ts and lib/drill/version.ts.
ASSESSMENT_VERSION = 1
GENERATOR_VERSION = 1
PROBE_LEVEL = 2

# The server's own copy of the blueprint. A response's drill_kind and skill_tag
# are written from THIS list at the reported index, never from the request:
# the client chooses neither which question it was asked nor what skill that
# question measures.
PLACEMENT_KINDS: tuple[str, ...] = (
    "outs", "rule24", "potodds", "decision", "implied",
    "ev", "bluff", "concepts", "preflop",
)
PLACEMENT_QUESTION_COUNT = len(PLACEMENT_KINDS)

# Settled StackSchool accuracy thresholds, shared with
# api/learning.py::difficulty_for_accuracy so placement, recommendations and
# drill difficulty all speak one accuracy vocabulary.
ENTRY_LOW = 0.40
ENTRY_HIGH = 0.75

# Nine questions of poker math say nothing about bankroll discipline, so
# placement may skip the foundations a player has outgrown and no further.
MAX_ENTRY_MODULE_INDEX = 2

# A single correct answer justifies starting a drill at level 2 and no more.
# Level 3 is unreachable from placement by design: the adaptive window promotes
# there after six answers at 80% anyway.
PLACED_LEVEL = 2
BASE_LEVEL = 1


class PlacementResponseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assessment_id: int = Field(gt=0)
    question_index: int = Field(ge=0, lt=PLACEMENT_QUESTION_COUNT)
    is_correct: bool
    response_type: Literal["answer", "unsure"] = "answer"
    answer: str = Field(min_length=1, max_length=256)


class PlacementFinishIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assessment_id: int = Field(gt=0)


# ---------------------------------------------------------------------
# Pure scoring — mirrors lib/placement/blueprint.ts
# ---------------------------------------------------------------------

Response = tuple[int, bool, bool]  # (question_index, is_correct, is_unsure)


def tag_scores(responses: list[Response]) -> dict[str, dict[str, Any]]:
    """Per-skill-tag scores. Every blueprint tag appears, even at zero asked."""
    scores: dict[str, dict[str, Any]] = {}
    for kind in PLACEMENT_KINDS:
        tag = skill_tag_for(kind)
        scores.setdefault(tag, {"tag": tag, "asked": 0, "correct": 0, "unsure": 0})
    for index, is_correct, is_unsure in responses:
        if not 0 <= index < PLACEMENT_QUESTION_COUNT:
            continue
        score = scores[skill_tag_for(PLACEMENT_KINDS[index])]
        score["asked"] += 1
        if is_unsure:
            score["unsure"] += 1
        elif is_correct:
            score["correct"] += 1
    return scores


def placement_levels(responses: list[Response]) -> dict[str, int]:
    """Starting difficulty per drill kind. Unanswered kinds are absent."""
    levels: dict[str, int] = {}
    for index, is_correct, is_unsure in responses:
        if not 0 <= index < PLACEMENT_QUESTION_COUNT:
            continue
        kind = PLACEMENT_KINDS[index]
        earned = PLACED_LEVEL if (is_correct and not is_unsure) else BASE_LEVEL
        levels[kind] = max(levels.get(kind, BASE_LEVEL), earned)
    return levels


def placement_accuracy(responses: list[Response]) -> float:
    """Correct fraction. An unsure answer counts against, as a miss does."""
    if not responses:
        return 0.0
    correct = sum(1 for _, ok, unsure in responses if ok and not unsure)
    return correct / len(responses)


def entry_module_index(responses: list[Response]) -> int:
    """The 0-based module index the path should start at."""
    if not responses:
        return 0
    accuracy = placement_accuracy(responses)
    if accuracy < ENTRY_LOW:
        return 0
    if accuracy < ENTRY_HIGH:
        return 1
    return MAX_ENTRY_MODULE_INDEX


# ---------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------


def _assessment_out(row: tuple[Any, ...]) -> dict[str, Any]:
    (
        assessment_id,
        assessment_version,
        generator_version,
        seed,
        state,
        question_count,
        scores,
        levels,
        module_index,
        started_at,
        completed_at,
    ) = row
    return {
        "id": assessment_id,
        "assessment_version": assessment_version,
        "generator_version": generator_version,
        "seed": seed,
        "status": state,
        "question_count": question_count,
        "scores": scores,
        "levels": levels,
        "entry_module_index": module_index,
        "started_at": started_at,
        "completed_at": completed_at,
    }


ASSESSMENT_SELECT = """
    select id, assessment_version, generator_version, seed, status,
           question_count, scores, levels, entry_module_index,
           started_at, completed_at
    from placement_assessments
"""


def _latest(cur: Any, user_id: str):
    cur.execute(
        ASSESSMENT_SELECT
        + " where user_id = %s order by started_at desc, id desc limit 1",
        (user_id,),
    )
    return cur.fetchone()


def _owned(cur: Any, user_id: str, assessment_id: int):
    """Fetch an assessment, 404ing rather than 403ing when it is not yours.

    Owner-scoping is enforced in the WHERE clause as well as by RLS: this
    connection is service-role in some deployments, and a route that relies on
    a policy it does not control is one config change from leaking.
    """
    cur.execute(
        ASSESSMENT_SELECT + " where id = %s and user_id = %s",
        (assessment_id, user_id),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "assessment not found")
    return row


@router.get("/api/placement/state")
def placement_state(user_id: str = Depends(current_user_id)) -> dict[str, Any]:
    """The player's most recent assessment, and whether one is owed.

    ``needs_placement`` is the routing signal: no assessment has ever been
    started AND the account has never answered anything. The attempt check is
    what keeps an established player from being dragged into an onboarding
    flow — placement is for new accounts, and a long-standing user who has
    simply never seen it should find it when they look, not be interrupted.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            latest = _latest(cur, user_id)
            cur.execute(
                "select 1 from attempts where user_id = %s limit 1", (user_id,)
            )
            has_history = cur.fetchone() is not None
        conn.commit()
    return {
        "assessment": _assessment_out(latest) if latest else None,
        "needs_placement": latest is None and not has_history,
        "assessment_version": ASSESSMENT_VERSION,
        "generator_version": GENERATOR_VERSION,
        "question_count": PLACEMENT_QUESTION_COUNT,
    }


class PlacementStartIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Supplied by the client so the questions it already dealt and the row the
    # server stores describe the same assessment. Bounded to stay inside a
    # 32-bit rng seed space.
    seed: int = Field(ge=0, le=2**31 - 1)


@router.post("/api/placement/start")
def start_placement(
    body: PlacementStartIn,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    """Begin an assessment, or resume the one already in progress.

    Resuming rather than starting a second row matters for a reload halfway
    through: a new row would discard the answers already given and re-deal
    from a different seed, so the player would silently restart.
    """
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                latest = _latest(cur, user_id)
                if latest is not None and latest[4] == "in_progress":
                    row = latest
                else:
                    cur.execute(
                        """
                        insert into placement_assessments
                            (user_id, assessment_version, generator_version,
                             seed, status, question_count)
                        values (%s, %s, %s, %s, 'in_progress', %s)
                        returning id, assessment_version, generator_version,
                                  seed, status, question_count, scores, levels,
                                  entry_module_index, started_at, completed_at
                        """,
                        (
                            user_id,
                            ASSESSMENT_VERSION,
                            GENERATOR_VERSION,
                            body.seed,
                            PLACEMENT_QUESTION_COUNT,
                        ),
                    )
                    row = cur.fetchone()
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return _assessment_out(row)


@router.post("/api/placement/responses")
def record_placement_response(
    body: PlacementResponseIn,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    kind = PLACEMENT_KINDS[body.question_index]
    is_unsure = body.response_type == "unsure"
    # An unsure answer is never correct, whatever the client claims — the same
    # rule /progress/attempts applies (M8.5C).
    is_correct = False if is_unsure else body.is_correct

    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                row = _owned(cur, user_id, body.assessment_id)
                if row[4] != "in_progress":
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        "this assessment is already finished",
                    )
                cur.execute(
                    """
                    insert into placement_responses
                        (assessment_id, question_index, drill_kind, skill_tag,
                         response_type, is_correct, answer)
                    values (%s, %s, %s, %s, %s, %s, %s)
                    on conflict (assessment_id, question_index) do update
                    set drill_kind    = excluded.drill_kind,
                        skill_tag     = excluded.skill_tag,
                        response_type = excluded.response_type,
                        is_correct    = excluded.is_correct,
                        answer        = excluded.answer
                    returning id
                    """,
                    (
                        body.assessment_id,
                        body.question_index,
                        kind,
                        skill_tag_for(kind),
                        body.response_type,
                        is_correct,
                        body.answer,
                    ),
                )
                response_id = cur.fetchone()[0]
        except Exception:
            conn.rollback()
            raise
        conn.commit()

    return {
        "id": response_id,
        "question_index": body.question_index,
        "drill_kind": kind,
        "skill_tag": skill_tag_for(kind),
        "is_correct": is_correct,
        "response_type": body.response_type,
    }


def _placed_out_lessons(cur: Any, user_id: str, module_index: int) -> int:
    """Mark every lesson before the entry module as satisfied by placement.

    Status ``placed_out``, never ``completed``: the player did not take these
    lessons, and saying they did would make the completion meter claim work
    that never happened. ``do nothing`` on conflict so a real completion — or a
    second placement — never overwrites existing progress.
    """
    if module_index <= 0:
        return 0
    cur.execute(
        """
        with entry as (
            select id from modules where is_active
            order by order_index, id limit %s
        )
        insert into progress (user_id, lesson_id, status)
        select %s, l.id, 'placed_out'
        from lessons l
        join entry on entry.id = l.module_id
        where l.is_active
        on conflict (user_id, lesson_id) do nothing
        """,
        (module_index, user_id),
    )
    return cur.rowcount


@router.post("/api/placement/complete")
def complete_placement(
    body: PlacementFinishIn,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    """Score the assessment from its stored responses and apply the result.

    Scored server-side from ``placement_responses`` rather than from anything
    in this request: the client reports one answer at a time and never gets to
    state its own placement.
    """
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                row = _owned(cur, user_id, body.assessment_id)
                if row[4] == "skipped":
                    raise HTTPException(
                        status.HTTP_409_CONFLICT, "this assessment was skipped"
                    )
                cur.execute(
                    """
                    select question_index, is_correct, response_type
                    from placement_responses
                    where assessment_id = %s
                    order by question_index
                    """,
                    (body.assessment_id,),
                )
                responses: list[Response] = [
                    (index, bool(ok), kind == "unsure")
                    for index, ok, kind in cur.fetchall()
                ]

                scores = tag_scores(responses)
                levels = placement_levels(responses)
                module_index = entry_module_index(responses)
                placed_out = _placed_out_lessons(cur, user_id, module_index)

                cur.execute(
                    """
                    update placement_assessments
                    set status = 'completed', scores = %s, levels = %s,
                        entry_module_index = %s, completed_at = now()
                    where id = %s and user_id = %s
                    returning id, assessment_version, generator_version, seed,
                              status, question_count, scores, levels,
                              entry_module_index, started_at, completed_at
                    """,
                    (
                        Json(scores),
                        Json(levels),
                        module_index,
                        body.assessment_id,
                        user_id,
                    ),
                )
                updated = cur.fetchone()
        except Exception:
            conn.rollback()
            raise
        conn.commit()

    out = _assessment_out(updated)
    out["answered"] = len(responses)
    out["accuracy"] = placement_accuracy(responses)
    out["lessons_placed_out"] = placed_out
    # Stated explicitly in the response so no client has to infer it: placement
    # is not practice and earns nothing.
    out["xp_earned"] = 0
    return out


@router.post("/api/placement/skip")
def skip_placement(
    body: PlacementFinishIn,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    """Abandon the assessment without being placed.

    A skip records a row, so the player is not asked again on every sign-in,
    and applies nothing: no levels, no placed-out lessons, no entry module.
    That is exactly today's cold-start behaviour, which is what the brief
    requires the skip path to fall back to. It stays retakeable.
    """
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                _owned(cur, user_id, body.assessment_id)
                cur.execute(
                    """
                    update placement_assessments
                    set status = 'skipped', completed_at = now()
                    where id = %s and user_id = %s and status = 'in_progress'
                    returning id, assessment_version, generator_version, seed,
                              status, question_count, scores, levels,
                              entry_module_index, started_at, completed_at
                    """,
                    (body.assessment_id, user_id),
                )
                updated = cur.fetchone()
                if updated is None:
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        "this assessment is already finished",
                    )
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return _assessment_out(updated)
