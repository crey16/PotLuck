"""Authenticated M8 durable play-history APIs.

All writes are owner-scoped from the verified JWT.  Client UUIDs make session,
hand, and decision retries idempotent; the client never supplies grading
fields.  A decision and its legacy-compatible XP attempt are committed in the
same transaction so neither can exist without the other.
"""
from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from psycopg.types.json import Json
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from api.db import get_connection
from api.deps import current_user_id
from api.play_solver import (
    PACK_GRADING_VERSION,
    SOLUTION_PROFILE_ID,
    SOLUTION_VERSION,
    SOLVE_PACK_ID,
    SPOT,
    SolveDataError,
    completion_snapshots,
    get_hand,
    grade_decision,
    is_right_verdict,
    load_catalog,
    next_node_or_end,
    pack_availability,
    parse_source_hand_id,
    parse_stable_node_id,
    source_hand_id,
    stable_node_id,
)
from api.progress import next_streak, recalc_level, today_et

router = APIRouter()

PLAY_STATUSES = ("incomplete", "completed", "abandoned")
XP_CORRECT_PLAY_DECISION = 10

PLAY_SKILL_STATS_SQL = """
    insert into skill_stats (user_id, skill_tag, total_attempts, correct_attempts)
    values (%s, 'postflop_play', 1, %s)
    on conflict (user_id, skill_tag) do update
    set total_attempts   = skill_stats.total_attempts + 1,
        correct_attempts = skill_stats.correct_attempts + excluded.correct_attempts
"""


class PlayConfigIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    solution_profile_id: Literal["cash-6max-chip-ev"] = SOLUTION_PROFILE_ID
    solution_version: Literal["m6-v1"] = SOLUTION_VERSION
    table_size: Literal[6] = 6
    hero_positions: list[str] = Field(default_factory=lambda: ["BTN", "BB"])
    matchup_positions: list[str] = Field(default_factory=lambda: ["BTN", "BB"])
    starting_spot: Literal["preflop"] = "preflop"
    action_family_filters: list[Literal["single_raised_pot"]] = Field(
        default_factory=lambda: ["single_raised_pot"]
    )
    stack_depth_bb: Literal[100] = 100
    rake_model: Literal["none"] = "none"
    ev_model: Literal["chip_ev"] = "chip_ev"
    advanced_settings: dict[str, Any] = Field(default_factory=dict)

    @field_validator("hero_positions", "matchup_positions")
    @classmethod
    def _positions_supported(cls, value: list[str]) -> list[str]:
        normalized = [item.strip().upper() for item in value]
        if normalized != ["BTN", "BB"]:
            raise ValueError(
                "the current solve pack requires hero/matchup positions BTN + BB"
            )
        return normalized

    @field_validator("action_family_filters")
    @classmethod
    def _one_supported_family(cls, value: list[str]) -> list[str]:
        if value != ["single_raised_pot"]:
            raise ValueError("this solve pack only supports single-raised pots")
        return value

    @field_validator("advanced_settings")
    @classmethod
    def _no_unpublished_settings(cls, value: dict[str, Any]) -> dict[str, Any]:
        if value:
            raise ValueError("the current solve pack has no advanced settings")
        return value


class PlaySessionCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_session_id: UUID
    solve_pack_id: Literal["potluck:m6:srp-btn-bb:v1"] = SOLVE_PACK_ID
    config: PlayConfigIn = Field(default_factory=PlayConfigIn)


class PlayHandCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_hand_id: UUID
    source_hand_id: str | None = Field(default=None, max_length=256)
    flop: str | None = Field(default=None, pattern=r"^(?:[2-9TJQKA][shdc]){3}$")
    instance_index: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _one_hand_reference(self) -> "PlayHandCreateIn":
        stable_supplied = self.source_hand_id is not None
        parts_supplied = self.flop is not None or self.instance_index is not None
        if stable_supplied == parts_supplied:
            raise ValueError("supply source_hand_id or flop + instance_index")
        if parts_supplied and (self.flop is None or self.instance_index is None):
            raise ValueError("flop and instance_index must be supplied together")
        return self

    def resolve(self) -> tuple[str, int, str]:
        try:
            if self.source_hand_id is not None:
                flop, index = parse_source_hand_id(self.source_hand_id)
                return flop, index, self.source_hand_id
            assert self.flop is not None and self.instance_index is not None
            return self.flop, self.instance_index, source_hand_id(
                self.flop, self.instance_index
            )
        except SolveDataError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


class PlayDecisionCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_decision_id: UUID
    node_path: str | None = Field(default=None, max_length=256)
    solve_node_id: str | None = Field(default=None, max_length=512)
    chosen_action_code: str = Field(min_length=1, max_length=32)

    @model_validator(mode="after")
    def _one_node_reference(self) -> "PlayDecisionCreateIn":
        if (self.node_path is None) == (self.solve_node_id is None):
            raise ValueError("supply node_path or solve_node_id")
        return self

    def resolve_path(self, stable_hand_id: str) -> str:
        try:
            if self.solve_node_id is not None:
                return parse_stable_node_id(stable_hand_id, self.solve_node_id)
            assert self.node_path is not None
            # stable_node_id validates the suffix grammar.
            stable_node_id(stable_hand_id, self.node_path)
            return self.node_path
        except SolveDataError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


class PlayStatusUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["completed", "abandoned"]


def _guard_pack() -> dict[str, Any]:
    """Fail fast, and legibly, when the solve pack is not in this bundle.

    The canonical pack lives under ``solver/pack/`` precisely so it ships with
    this function; ``public/`` is stripped from the bundle.  If that ever
    regresses, callers should see an unambiguous 503 rather than a generic
    internal error.
    """
    try:
        return load_catalog()
    except Exception as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"play solve pack is unavailable on the server ({type(exc).__name__})",
        ) from exc


def _public_row(row: dict[str, Any]) -> dict[str, Any]:
    """Remove owner internals and expose the stored configuration as config."""
    result = dict(row)
    result.pop("user_id", None)
    if "config_snapshot" in result:
        result["config"] = result.pop("config_snapshot")
    for key, value in list(result.items()):
        if isinstance(value, UUID):
            result[key] = str(value)
    return result


def _fetch_json_row(cur: Any, table: str, row_id: Any, user_id: str) -> dict[str, Any] | None:
    if table not in {"play_sessions", "play_hands"}:
        raise ValueError("unsupported play table")
    cur.execute(
        f"select to_jsonb(t) from {table} t where t.id = %s and t.user_id = %s",
        (row_id, user_id),
    )
    row = cur.fetchone()
    return row[0] if row else None


def _get_owned_hand_for_update(
    cur: Any, hand_id: UUID, user_id: str
) -> tuple[dict[str, Any], str]:
    # Resolve ownership without taking a row lock, then acquire the mutation
    # locks in the one global order: session -> hand.  A joined ``FOR UPDATE``
    # does not promise which relation PostgreSQL locks first and can deadlock
    # against session abandonment (which updates its child hands).
    cur.execute(
        """
        select session_id from play_hands
        where id = %s and user_id = %s
        """,
        (hand_id, user_id),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "play hand not found")
    session_id = row[0]
    cur.execute(
        """
        select status from play_sessions
        where id = %s and user_id = %s
        for update
        """,
        (session_id, user_id),
    )
    session_row = cur.fetchone()
    if session_row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "play hand not found")
    cur.execute(
        """
        select to_jsonb(h) from play_hands h
        where h.id = %s and h.user_id = %s and h.session_id = %s
        for update
        """,
        (hand_id, user_id, session_id),
    )
    hand_row = cur.fetchone()
    if hand_row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "play hand not found")
    return hand_row[0], session_row[0]


def _decision_rows(cur: Any, hand_id: UUID, user_id: str) -> list[tuple[str, str]]:
    cur.execute(
        """
        select solve_node_id, chosen_action_code
        from play_decisions
        where hand_id = %s and user_id = %s
        order by decision_index, created_at, id
        """,
        (hand_id, user_id),
    )
    return [(row[0], row[1]) for row in cur.fetchall()]


def _lock_profile(cur: Any, user_id: str) -> tuple[Any, ...]:
    cur.execute(
        """
        select xp, streak_count, last_active_date
        from profiles where id = %s for update
        """,
        (user_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "profile not found")
    return row


def _record_attempt_xp(
    cur: Any,
    user_id: str,
    profile: tuple[Any, ...],
    grade: dict[str, Any],
    payload: dict[str, Any],
) -> tuple[int, int]:
    """Insert the generic attempt and update the established XP/streak flow."""
    right = is_right_verdict(grade["verdict"])
    xp_earned = XP_CORRECT_PLAY_DECISION if right else 0
    cur.execute(
        """
        insert into attempts
            (user_id, drill_kind, drill_payload, is_correct, selected_choice_id)
        values (%s, 'play', %s, %s, %s)
        returning id
        """,
        (user_id, Json(payload), right, grade["chosen_action_code"]),
    )
    attempt_id = cur.fetchone()[0]
    cur.execute(PLAY_SKILL_STATS_SQL, (user_id, 1 if right else 0))

    xp, streak_count, last_active_date = profile
    today = today_et()
    new_xp = xp + xp_earned
    new_level = recalc_level(new_xp)
    new_streak, new_last_active = next_streak(last_active_date, streak_count, today)
    cur.execute(
        """
        insert into user_daily_activity (user_id, date, xp_earned)
        values (%s, %s, %s)
        on conflict (user_id, date) do update
        set xp_earned = user_daily_activity.xp_earned + excluded.xp_earned
        """,
        (user_id, today, xp_earned),
    )
    cur.execute(
        """
        update profiles
        set xp = %s, level = %s, streak_count = %s, last_active_date = %s
        where id = %s
        """,
        (new_xp, new_level, new_streak, new_last_active, user_id),
    )
    return attempt_id, xp_earned


def _decision_out(row: dict[str, Any], actions: list[dict[str, Any]], xp_earned: int) -> dict[str, Any]:
    result = _public_row(row)
    result["actions"] = [_public_row(action) for action in actions]
    result["xp_earned"] = xp_earned
    return result


def _fetch_decision_review(cur: Any, decision_id: UUID, user_id: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    cur.execute(
        """
        select to_jsonb(d)
        from play_decisions d
        where d.id = %s and d.user_id = %s
        """,
        (decision_id, user_id),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "play decision not found")
    cur.execute(
        """
        select to_jsonb(a)
        from play_decision_actions a
        where a.decision_id = %s
        order by a.ordinal, a.action_code
        """,
        (decision_id,),
    )
    return row[0], [item[0] for item in cur.fetchall()]


@router.get("/api/play/pack")
def play_pack_status(
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    """Report solve-pack readability so a bundling fault is diagnosable."""
    return pack_availability()


@router.post("/api/play/sessions", status_code=status.HTTP_201_CREATED)
def create_play_session(
    body: PlaySessionCreateIn,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    config = body.config.model_dump(mode="json")
    catalog = _guard_pack()
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                # Serialize session creation per owner.  Without this lock,
                # two concurrent retries can both miss the idempotency row
                # and race into the unique constraint.
                cur.execute(
                    "select 1 from profiles where id = %s for update", (user_id,)
                )
                if cur.fetchone() is None:
                    raise HTTPException(status.HTTP_404_NOT_FOUND, "profile not found")
                cur.execute(
                    """
                    select solution_profile_id, solution_version, spot,
                           format_version, grading_version, content_hash
                    from play_solve_packs where id = %s
                    """,
                    (body.solve_pack_id,),
                )
                pack = cur.fetchone()
                expected_pack = (
                    catalog["solution_profile_id"],
                    catalog["solution_version"],
                    catalog["spot"],
                    catalog["format_version"],
                    catalog["grading_version"],
                    catalog["content_hash"],
                )
                if pack is None or tuple(pack) != expected_pack:
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        "solve-pack catalog does not match the server artifact",
                    )
                cur.execute(
                    """
                    select to_jsonb(s) from play_sessions s
                    where s.user_id = %s and s.client_session_id = %s
                    for update
                    """,
                    (user_id, body.client_session_id),
                )
                existing = cur.fetchone()
                if existing is not None:
                    row = existing[0]
                    if row["solve_pack_id"] != body.solve_pack_id or row["config_snapshot"] != config:
                        raise HTTPException(
                            status.HTTP_409_CONFLICT,
                            "client_session_id was already used with different data",
                        )
                    conn.commit()
                    return _public_row(row)

                cur.execute(
                    """
                    insert into play_sessions (
                        user_id, client_session_id, solve_pack_id, status,
                        config_snapshot, solution_profile_id, solution_version,
                        table_size, hero_positions, matchup_positions,
                        starting_spot, action_family_filters, stack_depth_bb,
                        rake_model, ev_model, advanced_settings
                    ) values (
                        %s, %s, %s, 'incomplete', %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s
                    ) returning id
                    """,
                    (
                        user_id,
                        body.client_session_id,
                        body.solve_pack_id,
                        Json(config),
                        config["solution_profile_id"],
                        config["solution_version"],
                        config["table_size"],
                        config["hero_positions"],
                        config["matchup_positions"],
                        config["starting_spot"],
                        config["action_family_filters"],
                        config["stack_depth_bb"],
                        config["rake_model"],
                        config["ev_model"],
                        Json(config["advanced_settings"]),
                    ),
                )
                session_id = cur.fetchone()[0]
                row = _fetch_json_row(cur, "play_sessions", session_id, user_id)
                assert row is not None
                # Refuse catalog/schema drift before accepting history.
                if catalog["id"] != row["solve_pack_id"]:
                    raise RuntimeError("play solve-pack catalog does not match database")
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return _public_row(row)


@router.post(
    "/api/play/sessions/{session_id}/hands",
    status_code=status.HTTP_201_CREATED,
)
def create_play_hand(
    session_id: UUID,
    body: PlayHandCreateIn,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    _guard_pack()
    flop, instance_index, stable_hand_id = body.resolve()
    solve, instance = get_hand(flop, instance_index)
    hero_position = "BTN" if instance["hero"] == 1 else "BB"
    opponent_position = "BB" if instance["hero"] == 1 else "BTN"
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select to_jsonb(s) from play_sessions s
                    where s.id = %s and s.user_id = %s
                    for update
                    """,
                    (session_id, user_id),
                )
                session_row = cur.fetchone()
                if session_row is None:
                    raise HTTPException(status.HTTP_404_NOT_FOUND, "play session not found")
                session = session_row[0]
                cur.execute(
                    """
                    select to_jsonb(h) from play_hands h
                    where h.session_id = %s and h.client_hand_id = %s
                    """,
                    (session_id, body.client_hand_id),
                )
                existing = cur.fetchone()
                if existing is not None:
                    row = existing[0]
                    if row["source_hand_id"] != stable_hand_id:
                        raise HTTPException(
                            status.HTTP_409_CONFLICT,
                            "client_hand_id was already used with different data",
                        )
                    conn.commit()
                    return _public_row(row)

                if session["status"] != "incomplete":
                    raise HTTPException(status.HTTP_409_CONFLICT, "play session is already closed")
                if session["solve_pack_id"] != SOLVE_PACK_ID:
                    raise HTTPException(status.HTTP_409_CONFLICT, "solve pack does not match session")
                if (
                    hero_position not in session["hero_positions"]
                    or opponent_position not in session["matchup_positions"]
                ):
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        "source hand positions are outside the session configuration",
                    )

                cur.execute(
                    "select coalesce(max(hand_index), -1) + 1 from play_hands where session_id = %s",
                    (session_id,),
                )
                hand_index = cur.fetchone()[0]
                cur.execute(
                    """
                    insert into play_hands (
                        session_id, user_id, client_hand_id, source_hand_id,
                        solve_pack_id, status, hand_index, hero_position,
                        opponent_positions, spot, stack_depth_bb,
                        starting_node_id, starting_street, hero_cards,
                        opponent_cards, initial_board_cards, deal_snapshot
                    ) values (
                        %s, %s, %s, %s, %s, 'incomplete', %s, %s, %s, %s,
                        %s, %s, 'preflop', %s, %s, %s, %s
                    ) returning id
                    """,
                    (
                        session_id,
                        user_id,
                        body.client_hand_id,
                        stable_hand_id,
                        SOLVE_PACK_ID,
                        hand_index,
                        hero_position,
                        [opponent_position],
                        SPOT,
                        100,
                        stable_node_id(stable_hand_id, "preflop"),
                        [instance["hand"][:2], instance["hand"][2:]],
                        Json(
                            {
                                opponent_position: [
                                    instance["bot"][:2],
                                    instance["bot"][2:],
                                ]
                            }
                        ),
                        [flop[index : index + 2] for index in range(0, 6, 2)],
                        Json(
                            {
                                "flop": flop,
                                "instance_index": instance_index,
                                "bot_hand": instance["bot"],
                                "pot_chips": solve["pot"],
                                "stack_chips": solve["stack"],
                            }
                        ),
                    ),
                )
                hand_id = cur.fetchone()[0]
                cur.execute(
                    """
                    update play_sessions set last_activity_at = now()
                    where id = %s and user_id = %s
                    """,
                    (session_id, user_id),
                )
                row = _fetch_json_row(cur, "play_hands", hand_id, user_id)
                assert row is not None
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return _public_row(row)


@router.post(
    "/api/play/hands/{hand_id}/decisions",
    status_code=status.HTTP_201_CREATED,
)
def create_play_decision(
    hand_id: UUID,
    body: PlayDecisionCreateIn,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    _guard_pack()
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                # Global mutation lock order is profile -> session -> hand.
                # Session creation also starts at the profile row; retaining
                # this tuple for the eventual XP update avoids a reverse
                # session/hand -> profile edge and its deadlock cycle.
                profile = _lock_profile(cur, user_id)
                hand, session_status = _get_owned_hand_for_update(cur, hand_id, user_id)
                stable_hand_id = hand["source_hand_id"]
                node_path = body.resolve_path(stable_hand_id)

                cur.execute(
                    """
                    select id, solve_node_id, chosen_action_code
                    from play_decisions
                    where hand_id = %s and client_decision_id = %s
                    """,
                    (hand_id, body.client_decision_id),
                )
                duplicate = cur.fetchone()
                if duplicate is not None:
                    decision_id, old_node_id, old_action = duplicate
                    expected_node_id = stable_node_id(stable_hand_id, node_path)
                    if old_node_id != expected_node_id or old_action != body.chosen_action_code:
                        raise HTTPException(
                            status.HTTP_409_CONFLICT,
                            "client_decision_id was already used with different data",
                        )
                    row, actions = _fetch_decision_review(cur, decision_id, user_id)
                    conn.commit()
                    return _decision_out(row, actions, xp_earned=0)

                if hand["status"] != "incomplete" or session_status != "incomplete":
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        "play hand or its session is already closed",
                    )
                flop, instance_index = parse_source_hand_id(stable_hand_id)
                saved = _decision_rows(cur, hand_id, user_id)
                expected_node_id, terminal = next_node_or_end(flop, instance_index, saved)
                requested_node_id = stable_node_id(stable_hand_id, node_path)
                if terminal is not None or expected_node_id != requested_node_id:
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        "decision is not the next node on this hand's solve branch",
                    )

                try:
                    grade = grade_decision(
                        flop, instance_index, node_path, body.chosen_action_code
                    )
                except SolveDataError as exc:
                    raise HTTPException(
                        status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)
                    ) from exc

                attempt_payload = {
                    "solve_pack_id": SOLVE_PACK_ID,
                    "source_hand_id": stable_hand_id,
                    "solve_node_id": grade["solve_node_id"],
                    "spot": SPOT,
                    "phase": "preflop" if grade["street"] == "preflop" else "postflop",
                    "hero": 1 if hand["hero_position"] == "BTN" else 0,
                    "hand": "".join(hand["hero_cards"]),
                    "street": grade["street"],
                    "chosen": grade["chosen_action_code"],
                    "frequency": grade["chosen_frequency"],
                    "ev_loss_bb": grade["ev_loss_bb"],
                    "verdict": grade["verdict"],
                    "grading_source": grade["grading_source"],
                    "grading_version": grade["grading_version"],
                }
                attempt_id, xp_earned = _record_attempt_xp(
                    cur, user_id, profile, grade, attempt_payload
                )
                cur.execute(
                    """
                    insert into play_decisions (
                        hand_id, user_id, client_decision_id, decision_index,
                        solve_pack_id, solve_node_id, position, spot,
                        stack_depth_bb, street, board_cards, board_texture,
                        hand_class, action_context, chosen_action_code,
                        grading_source, grading_status, grading_version,
                        ev_basis, chosen_frequency, chosen_ev_bb,
                        best_ev_bb, ev_loss_bb, verdict,
                        alternatives_complete, attempt_id
                    ) values (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s
                    ) returning id
                    """,
                    (
                        hand_id,
                        user_id,
                        body.client_decision_id,
                        grade["decision_index"],
                        SOLVE_PACK_ID,
                        grade["solve_node_id"],
                        hand["hero_position"],
                        SPOT,
                        hand["stack_depth_bb"],
                        grade["street"],
                        grade["board_cards"],
                        grade["board_texture"],
                        grade["hand_class"],
                        Json(grade["action_context"]),
                        grade["chosen_action_code"],
                        grade["grading_source"],
                        grade["grading_status"],
                        grade["grading_version"],
                        grade["ev_basis"],
                        grade["chosen_frequency"],
                        grade["chosen_ev_bb"],
                        grade["best_ev_bb"],
                        grade["ev_loss_bb"],
                        grade["verdict"],
                        grade["alternatives_complete"],
                        attempt_id,
                    ),
                )
                decision_id = cur.fetchone()[0]
                for action in grade["actions"]:
                    cur.execute(
                        """
                        insert into play_decision_actions (
                            decision_id, user_id, action_code, ordinal,
                            action_label, action_kind, amount_bb, frequency,
                            ev_bb, ev_delta_bb, ev_loss_bb, is_chosen
                        ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            decision_id,
                            user_id,
                            action["action_code"],
                            action["ordinal"],
                            action["action_label"],
                            action["action_kind"],
                            action["amount_bb"],
                            action["frequency"],
                            action["ev_bb"],
                            action["ev_delta_bb"],
                            action["ev_loss_bb"],
                            action["is_chosen"],
                        ),
                    )
                cur.execute(
                    """
                    update play_hands set last_activity_at = now()
                    where id = %s and user_id = %s
                    """,
                    (hand_id, user_id),
                )
                cur.execute(
                    """
                    update play_sessions set last_activity_at = now()
                    where id = %s and user_id = %s
                    """,
                    (hand["session_id"], user_id),
                )
                row, actions = _fetch_decision_review(cur, decision_id, user_id)
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return _decision_out(row, actions, xp_earned)


@router.patch("/api/play/hands/{hand_id}")
def update_play_hand_status(
    hand_id: UUID,
    body: PlayStatusUpdateIn,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                hand, session_status = _get_owned_hand_for_update(cur, hand_id, user_id)
                if hand["status"] == body.status:
                    conn.commit()
                    return _public_row(hand)
                if hand["status"] != "incomplete":
                    raise HTTPException(status.HTTP_409_CONFLICT, "play hand is already closed")
                if body.status == "completed" and session_status != "incomplete":
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        "hand cannot complete after its session is closed",
                    )
                result_snapshot: dict[str, Any] | None = None
                runout_cards: list[str] = []
                action_history: list[dict[str, Any]] = []
                if body.status == "completed":
                    # Guarded only here: abandoning a hand is the recovery path
                    # and must stay available even if the pack is unreadable.
                    _guard_pack()
                    flop, instance_index = parse_source_hand_id(hand["source_hand_id"])
                    try:
                        runout_cards, action_history, result_snapshot = completion_snapshots(
                            flop,
                            instance_index,
                            _decision_rows(cur, hand_id, user_id),
                        )
                    except SolveDataError as exc:
                        raise HTTPException(
                            status.HTTP_409_CONFLICT,
                            "hand cannot complete before its solve branch ends",
                        ) from exc
                cur.execute(
                    """
                    update play_hands
                    set status = %s, result_snapshot = %s,
                        runout_cards = %s, action_history_snapshot = %s,
                        completed_at = case when %s = 'completed' then now() else null end,
                        abandoned_at = case when %s = 'abandoned' then now() else null end,
                        last_activity_at = now()
                    where id = %s and user_id = %s
                    """,
                    (
                        body.status,
                        Json(result_snapshot) if result_snapshot is not None else None,
                        runout_cards,
                        Json(action_history),
                        body.status,
                        body.status,
                        hand_id,
                        user_id,
                    ),
                )
                cur.execute(
                    """
                    update play_sessions set last_activity_at = now()
                    where id = %s and user_id = %s
                    """,
                    (hand["session_id"], user_id),
                )
                row = _fetch_json_row(cur, "play_hands", hand_id, user_id)
                assert row is not None
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return _public_row(row)


@router.patch("/api/play/sessions/{session_id}")
def update_play_session_status(
    session_id: UUID,
    body: PlayStatusUpdateIn,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select to_jsonb(s) from play_sessions s
                    where s.id = %s and s.user_id = %s
                    for update
                    """,
                    (session_id, user_id),
                )
                found = cur.fetchone()
                if found is None:
                    raise HTTPException(status.HTTP_404_NOT_FOUND, "play session not found")
                session = found[0]
                if session["status"] == body.status:
                    conn.commit()
                    return _public_row(session)
                if session["status"] != "incomplete":
                    raise HTTPException(status.HTTP_409_CONFLICT, "play session is already closed")
                if body.status == "completed":
                    cur.execute(
                        """
                        select 1 from play_hands
                        where session_id = %s and user_id = %s and status = 'incomplete'
                        limit 1
                        """,
                        (session_id, user_id),
                    )
                    if cur.fetchone() is not None:
                        raise HTTPException(
                            status.HTTP_409_CONFLICT,
                            "session has an incomplete hand",
                        )
                else:
                    # Closing a session safely preserves its unfinished hand
                    # while making the abandonment explicit and queryable.
                    cur.execute(
                        """
                        update play_hands
                        set status = 'abandoned', abandoned_at = now(),
                            last_activity_at = now()
                        where session_id = %s and user_id = %s and status = 'incomplete'
                        """,
                        (session_id, user_id),
                    )
                cur.execute(
                    """
                    update play_sessions
                    set status = %s,
                        completed_at = case when %s = 'completed' then now() else null end,
                        abandoned_at = case when %s = 'abandoned' then now() else null end,
                        last_activity_at = now()
                    where id = %s and user_id = %s
                    """,
                    (body.status, body.status, body.status, session_id, user_id),
                )
                row = _fetch_json_row(cur, "play_sessions", session_id, user_id)
                assert row is not None
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return _public_row(row)


@router.get("/api/play/sessions")
def recent_play_sessions(
    limit: int = Query(default=20, ge=1, le=100),
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select to_jsonb(s) || jsonb_build_object(
                    'hand_count', count(distinct h.id),
                    'completed_hand_count', count(distinct h.id) filter (where h.status = 'completed'),
                    'decision_count', count(d.id),
                    'total_ev_loss_bb', coalesce(
                        sum(d.ev_loss_bb) filter (
                            where d.grading_status in ('validated', 'reference_graded')
                        ), 0
                    )
                )
                from play_sessions s
                left join play_hands h
                  on h.session_id = s.id and h.user_id = s.user_id
                left join play_decisions d
                  on d.hand_id = h.id and d.user_id = s.user_id
                where s.user_id = %s
                group by s.id
                order by s.started_at desc, s.id desc
                limit %s
                """,
                (user_id, limit),
            )
            rows = [row[0] for row in cur.fetchall()]
        conn.commit()
    return {"sessions": [_public_row(row) for row in rows]}


@router.get("/api/play/sessions/{session_id}/hands")
def recent_play_hands(
    session_id: UUID,
    limit: int = Query(default=50, ge=1, le=100),
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if _fetch_json_row(cur, "play_sessions", session_id, user_id) is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "play session not found")
            cur.execute(
                """
                select to_jsonb(h) || jsonb_build_object(
                    'decision_count', count(d.id),
                    'total_ev_loss_bb', coalesce(
                        sum(d.ev_loss_bb) filter (
                            where d.grading_status in ('validated', 'reference_graded')
                        ), 0
                    ),
                    'blunder_count', count(d.id) filter (
                        where d.verdict = 'blunder'
                          and d.grading_status in ('validated', 'reference_graded')
                    )
                )
                from play_hands h
                left join play_decisions d
                  on d.hand_id = h.id and d.user_id = h.user_id
                where h.session_id = %s and h.user_id = %s
                group by h.id
                order by h.hand_index desc, h.started_at desc, h.id desc
                limit %s
                """,
                (session_id, user_id, limit),
            )
            rows = [row[0] for row in cur.fetchall()]
        conn.commit()
    return {"hands": [_public_row(row) for row in rows]}


@router.get("/api/play/hands/{hand_id}")
def play_hand_review(
    hand_id: UUID,
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            hand = _fetch_json_row(cur, "play_hands", hand_id, user_id)
            if hand is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "play hand not found")
            cur.execute(
                """
                select to_jsonb(d)
                from play_decisions d
                where d.hand_id = %s and d.user_id = %s
                order by d.decision_index, d.created_at, d.id
                """,
                (hand_id, user_id),
            )
            decision_rows = [row[0] for row in cur.fetchall()]
            decisions: list[dict[str, Any]] = []
            for decision in decision_rows:
                cur.execute(
                    """
                    select to_jsonb(a) from play_decision_actions a
                    where a.decision_id = %s
                    order by a.ordinal, a.action_code
                    """,
                    (decision["id"],),
                )
                actions = [_public_row(row[0]) for row in cur.fetchall()]
                item = _public_row(decision)
                item["actions"] = actions
                decisions.append(item)
        conn.commit()
    result = _public_row(hand)
    result["decisions"] = decisions
    return result
