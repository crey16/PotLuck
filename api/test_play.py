"""M8 play contract, immutable-pack grading, and lifecycle tests."""
from __future__ import annotations

import hashlib
import inspect
import json
import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import api.play as play_api
from api.play import (
    PLAY_STATUSES,
    PlayConfigIn,
    PlayDecisionCreateIn,
    PlayHandCreateIn,
    PlaySessionCreateIn,
    PlayStatusUpdateIn,
    _decision_out,
    _record_attempt_xp,
)
from api.play_solver import (
    PACK_GRADING_VERSION,
    PREFLOP_GRADING_VERSION,
    SOLUTION_PROFILE_ID,
    SOLUTION_VERSION,
    SOLVE_PACK_ID,
    SolveDataError,
    _content_hash_from_inputs,
    completion_snapshots,
    compute_pack_content_hash,
    load_preflop_pack,
    preflop_verdict,
    grade_decision,
    load_catalog,
    load_manifest,
    next_node_or_end,
    parse_source_hand_id,
    postflop_verdict,
    source_hand_id,
    stable_node_id,
)

ROOT = Path(__file__).resolve().parents[1]
SOLVE_DIR = ROOT / "public" / "solves" / "srp-btn-bb"


def test_catalog_identity_and_digest_cover_every_grading_input() -> None:
    catalog = load_catalog()
    assert catalog["id"] == SOLVE_PACK_ID
    assert catalog["solution_profile_id"] == SOLUTION_PROFILE_ID
    assert catalog["solution_version"] == SOLUTION_VERSION
    assert catalog["grading_version"] == PACK_GRADING_VERSION

    # Reproduce solver/gen-play-catalog.ts exactly.  Importantly this hashes
    # the preflop EV pack and the version metadata in addition to the postflop
    # files; changing any solved number invalidates the pack id.  The preflop
    # file is appended AFTER the solve files — hash order is part of the format
    # and the two languages must agree on it.
    digest = hashlib.sha256()
    manifest_bytes = (SOLVE_DIR / "index.json").read_bytes()
    digest.update(manifest_bytes)
    manifest = json.loads(manifest_bytes)
    for entry in manifest["flops"]:
        digest.update((SOLVE_DIR / f"{entry['flop']}.json").read_bytes())
    digest.update((SOLVE_DIR / "preflop.json").read_bytes())
    canonical_metadata = {key: value for key, value in catalog.items() if key != "content_hash"}
    digest.update(
        json.dumps(canonical_metadata, separators=(",", ":"), ensure_ascii=False).encode()
    )
    assert catalog["content_hash"] == f"sha256:{digest.hexdigest()}"
    assert compute_pack_content_hash(catalog) == catalog["content_hash"]


def _hashed_inputs() -> tuple[bytes, list[bytes]]:
    manifest_bytes = (SOLVE_DIR / "index.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    solve_bytes = [
        (SOLVE_DIR / f"{entry['flop']}.json").read_bytes()
        for entry in manifest["flops"]
    ]
    solve_bytes.append((SOLVE_DIR / "preflop.json").read_bytes())
    return manifest_bytes, solve_bytes


def test_pack_digest_detects_a_one_byte_solve_tamper() -> None:
    catalog = load_catalog()
    manifest_bytes, solve_bytes = _hashed_inputs()
    assert _content_hash_from_inputs(catalog, manifest_bytes, solve_bytes) == catalog[
        "content_hash"
    ]
    tampered = list(solve_bytes)
    first = bytearray(tampered[0])
    first[len(first) // 2] ^= 1
    tampered[0] = bytes(first)
    assert _content_hash_from_inputs(catalog, manifest_bytes, tampered) != catalog[
        "content_hash"
    ]


def test_pack_digest_detects_a_one_byte_preflop_tamper() -> None:
    """A changed preflop EV must invalidate the pack, exactly like a solve file.

    Preflop EVs are grading inputs now, not decorative metadata.  Before
    M8.7A this file did not exist and preflop verdicts came from bundled
    reference ranges, so nothing in the pack covered them.
    """
    catalog = load_catalog()
    manifest_bytes, solve_bytes = _hashed_inputs()
    tampered = list(solve_bytes)
    last = bytearray(tampered[-1])
    last[len(last) // 2] ^= 1
    tampered[-1] = bytes(last)
    assert _content_hash_from_inputs(catalog, manifest_bytes, tampered) != catalog[
        "content_hash"
    ]


def test_manifest_has_stable_nonempty_instance_space() -> None:
    manifest = load_manifest()
    assert manifest["spot"] == "srp-btn-bb"
    assert len(manifest["flops"]) == 25
    assert sum(item["instances"] for item in manifest["flops"]) == 5_000


def test_source_hand_and_node_ids_embed_the_full_pack_version() -> None:
    hand_id = source_hand_id("As5h4h", 0)
    assert hand_id == f"{SOLVE_PACK_ID}/As5h4h#0"
    assert parse_source_hand_id(hand_id) == ("As5h4h", 0)
    assert stable_node_id(hand_id, "preflop") == f"{hand_id}/preflop"
    assert stable_node_id(hand_id, "root") == f"{hand_id}/root"
    assert stable_node_id(hand_id, "1.0") == f"{hand_id}/1.0"

    with pytest.raises(SolveDataError):
        parse_source_hand_id("some-old-pack/As5h4h#0")
    with pytest.raises(SolveDataError):
        source_hand_id("As5h4h", 200)
    with pytest.raises(SolveDataError):
        stable_node_id(hand_id, "bad/path")


def test_preflop_grade_comes_from_solver_evs_not_reference_ranges() -> None:
    """M8.7A: preflop carries a real EV loss in big blinds.

    Instance 0 is BB with KTs.  Before this, the grade came from the frequency
    ordering in lib/poker/ranges.ts and every EV field was None, which is why
    preflop was excluded from the GTO score.
    """
    grade = grade_decision("As5h4h", 0, "preflop", "c")
    assert grade["grading_source"] == "solver"
    assert grade["grading_status"] == "validated"
    assert grade["grading_version"] == PREFLOP_GRADING_VERSION
    # Absolute, unlike postflop's "relative_to_best": the preflop solve really
    # does produce a net stack change, so it is published as one.
    assert grade["ev_basis"] == "absolute_bb"
    assert grade["verdict"] == "correct"
    assert grade["ev_loss_bb"] == 0
    assert grade["chosen_ev_bb"] == grade["best_ev_bb"]

    # BB's actions are call and fold.  The reference scenario also offered a
    # 3-bet; the solved tree has none, so offering the button would mean
    # grading a line the pack does not contain.
    assert {action["action_code"] for action in grade["actions"]} == {"c", "f"}
    assert all(action["ev_bb"] is not None for action in grade["actions"])
    assert all(action["ev_loss_bb"] is not None for action in grade["actions"])
    # Pure strategy: exactly one action is taken, always.
    assert sum(action["frequency"] for action in grade["actions"]) == pytest.approx(1)
    assert sorted(action["frequency"] for action in grade["actions"]) == [0.0, 1.0]

    folding = grade_decision("As5h4h", 0, "preflop", "f")
    assert folding["ev_loss_bb"] > 0
    assert folding["chosen_ev_bb"] == -1.0  # the posted big blind, given up
    assert folding["verdict"] in {"inaccuracy", "blunder"}


def test_preflop_ev_loss_inside_the_measured_noise_is_not_a_mistake() -> None:
    """The published SE widens the correct band; it is not decoration.

    The EVs are averages over 25 flops with a median standard error near
    0.4bb — four times the whole `correct` band.  Grading the raw loss would
    manufacture blunders out of sampling noise, which is the failure
    reference-range grading was retired for.
    """
    # A loss of exactly the tolerance is fully absorbed.
    assert preflop_verdict(0.40, 0.40) == "correct"
    assert preflop_verdict(0.45, 0.40) == "correct"
    # Beyond it, only the resolvable part is graded: 1.00 - 0.40 = 0.60bb.
    assert preflop_verdict(1.00, 0.40) == "inaccuracy"
    assert preflop_verdict(2.00, 0.40) == "blunder"
    # With no uncertainty it collapses to the ordinary bands.
    assert preflop_verdict(0.05, 0.0) == "correct"
    assert preflop_verdict(0.80, 0.0) == "blunder"
    # Monotone in the loss, so a worse choice can never grade better.
    grades = ["correct", "inaccuracy", "blunder"]
    ranks = [grades.index(preflop_verdict(loss / 100, 0.30)) for loss in range(0, 400, 7)]
    assert ranks == sorted(ranks)


def test_preflop_pack_is_class_indexed_and_suit_agnostic() -> None:
    """Suit-isomorphic hands must grade identically.

    The six combos of 22 differ by up to 1.8bb in the raw per-combo EVs purely
    from the 25-flop sample.  Publishing that would teach a suit superstition,
    so the pack aggregates to 169 classes and grading looks up by class.
    """
    pack = load_preflop_pack()
    assert pack["hand_index"] == "class169"
    for position in ("BTN", "BB"):
        assert len(pack["roles"][position]["hands"]) == 169
        # Every hand must carry a precision, or grading has nothing to widen
        # its band with and silently falls back to false certainty.
        assert all(
            entry["se"] > 0 for entry in pack["roles"][position]["hands"].values()
        )


def test_historical_pack_ids_still_parse_but_are_never_minted() -> None:
    """A hand dealt under the v1 pack must still resolve after the v2 upgrade.

    The postflop solve files are byte-identical between the two packs, so the
    instance is the same one; only preflop grading changed.  Refusing to parse
    the old id would strand any hand left incomplete across the deploy.
    """
    assert source_hand_id("As5h4h", 0).startswith("potluck:m87a:srp-btn-bb:v2/")
    assert parse_source_hand_id("potluck:m6:srp-btn-bb:v1/As5h4h#0") == ("As5h4h", 0)
    with pytest.raises(SolveDataError):
        parse_source_hand_id("potluck:m6:srp-btn-bb:v0/As5h4h#0")


def test_postflop_grade_rederives_all_alternatives_and_relative_ev_loss() -> None:
    grade = grade_decision("As5h4h", 0, "root", "B18")
    assert grade["grading_source"] == "solver"
    assert grade["grading_status"] == "validated"
    assert grade["grading_version"] == PACK_GRADING_VERSION
    assert grade["ev_basis"] == "relative_to_best"
    assert grade["street"] == "flop"
    assert grade["board_cards"] == ["As", "5h", "4h"]
    assert grade["board_texture"] == "unpaired_two-tone_disconnected"
    assert grade["action_context"]["pot_bb"] == 5.5
    assert grade["chosen_frequency"] == 0
    assert grade["ev_loss_bb"] == pytest.approx(0.2)
    assert grade["chosen_ev_bb"] is None
    assert grade["best_ev_bb"] is None
    assert grade["verdict"] == "inaccuracy"
    assert grade["alternatives_complete"] is True
    assert [action["action_code"] for action in grade["actions"]] == ["X", "B18"]
    for action in grade["actions"]:
        assert action["ev_bb"] is None
        assert action["ev_delta_bb"] == pytest.approx(-action["ev_loss_bb"])


@pytest.mark.parametrize(
    "frequency,loss,expected",
    [
        (0, 0, "correct"),
        (0, 2, "correct"),
        (51, 3, "acceptable"),
        (51, 10, "acceptable"),
        (50, 10, "inaccuracy"),
        (255, 14, "inaccuracy"),
        (255, 15, "blunder"),
    ],
)
def test_postflop_verdict_thresholds_match_typescript(
    frequency: int, loss: int, expected: str
) -> None:
    assert postflop_verdict(frequency, loss) == expected


def test_decision_path_must_be_ordered_and_can_reach_a_terminal() -> None:
    hand_id = source_hand_id("As5h4h", 0)
    preflop = (f"{hand_id}/preflop", "c")
    root = (f"{hand_id}/root", "B18")  # action index 1
    child = (f"{hand_id}/1", "F")  # action index 0 -> terminal 1.0

    assert next_node_or_end("As5h4h", 0, [preflop]) == (f"{hand_id}/root", None)
    assert next_node_or_end("As5h4h", 0, [preflop, root]) == (
        f"{hand_id}/1",
        None,
    )
    next_node, terminal = next_node_or_end("As5h4h", 0, [preflop, root, child])
    assert next_node is None
    assert terminal is not None
    assert terminal["path"] == "1.0"
    assert terminal["k"] == "f"

    with pytest.raises(SolveDataError, match="preflop"):
        next_node_or_end("As5h4h", 0, [root])
    with pytest.raises(SolveDataError, match="branch"):
        next_node_or_end("As5h4h", 0, [preflop, (f"{hand_id}/0", "X")])


def test_completion_snapshot_freezes_runout_and_all_scripted_actions() -> None:
    hand_id = source_hand_id("As5h4h", 0)
    # Check/call line that deals 4s on the turn and 5d on the river, then
    # checks through to showdown.
    decisions = [
        (f"{hand_id}/preflop", "c"),
        (f"{hand_id}/root", "X"),
        (f"{hand_id}/0", "C"),
        (f"{hand_id}/0.1", "X"),
        (f"{hand_id}/0.1.0", "C"),
        (f"{hand_id}/0.1.0.1", "X"),
    ]
    runout, history, result = completion_snapshots("As5h4h", 0, decisions)
    assert runout == ["4s", "5d"]
    assert result == {
        "terminal_path": "0.1.0.1.0",
        "terminal_kind": "sd",
        "total_bets_chips": [78, 78],
        "final_board_cards": ["As", "5h", "4h", "4s", "5d"],
        "pot_chips": 211,
    }
    assert [event for event in history if event["type"] == "deal_card"] == [
        {"type": "deal_card", "street": "turn", "card": "4s"},
        {"type": "deal_card", "street": "river", "card": "5d"},
    ]
    assert history[:3] == [
        {
            "type": "hero_decision",
            "street": "preflop",
            "position": "BB",
            "solve_node_id": f"{hand_id}/preflop",
            "chosen_action_code": "c",
        },
        {
            "type": "player_action",
            "street": "preflop",
            "position": "BTN",
            "actor": "opponent",
            "action_code": "R25",
            "action_kind": "raise",
            "amount_to_bb": 2.5,
            "source": "scripted_line",
        },
        {
            "type": "player_action",
            "street": "preflop",
            "position": "BB",
            "actor": "hero",
            "action_code": "C",
            "action_kind": "call",
            "amount_to_bb": 2.5,
            "amount_added_bb": 1.5,
            "source": "scripted_line",
        },
    ]
    assert sum(event["type"] == "hero_action" for event in history) == len(decisions) - 1
    assert any(event["type"] == "opponent_action" for event in history)

    with pytest.raises(SolveDataError, match="non-terminal"):
        completion_snapshots("As5h4h", 0, decisions[:2])


def test_request_models_accept_only_supported_versioned_contract() -> None:
    session = PlaySessionCreateIn(client_session_id=uuid4())
    assert session.solve_pack_id == SOLVE_PACK_ID
    assert session.config.model_dump()["hero_positions"] == ["BTN", "BB"]
    assert PLAY_STATUSES == ("incomplete", "completed", "abandoned")
    assert PlayStatusUpdateIn(status="completed").status == "completed"

    with pytest.raises(ValidationError):
        PlaySessionCreateIn(client_session_id=uuid4(), solve_pack_id="latest")
    with pytest.raises(ValidationError):
        PlayConfigIn(stack_depth_bb=50)
    with pytest.raises(ValidationError):
        PlayConfigIn(hero_positions=["BTN"])
    with pytest.raises(ValidationError):
        PlayConfigIn(matchup_positions=["BB", "BTN"])
    with pytest.raises(ValidationError):
        PlayConfigIn(advanced_settings={"unsupported": True})
    with pytest.raises(ValidationError):
        PlayStatusUpdateIn(status="incomplete")


def test_hand_request_supports_parts_or_stable_id_but_not_ambiguous_input() -> None:
    request = PlayHandCreateIn(
        client_hand_id=uuid4(), flop="As5h4h", instance_index=0
    )
    assert request.resolve() == (
        "As5h4h",
        0,
        f"{SOLVE_PACK_ID}/As5h4h#0",
    )
    stable = PlayHandCreateIn(
        client_hand_id=uuid4(), source_hand_id=f"{SOLVE_PACK_ID}/As5h4h#0"
    )
    assert stable.resolve() == request.resolve()
    with pytest.raises(ValidationError):
        PlayHandCreateIn(client_hand_id=uuid4())
    with pytest.raises(ValidationError):
        PlayHandCreateIn(
            client_hand_id=uuid4(),
            source_hand_id=f"{SOLVE_PACK_ID}/As5h4h#0",
            flop="As5h4h",
            instance_index=0,
        )


def test_decision_request_forbids_client_supplied_grading_fields() -> None:
    request = PlayDecisionCreateIn(
        client_decision_id=uuid4(), node_path="root", chosen_action_code="X"
    )
    assert request.resolve_path(f"{SOLVE_PACK_ID}/As5h4h#0") == "root"
    with pytest.raises(ValidationError):
        PlayDecisionCreateIn(
            client_decision_id=uuid4(),
            node_path="root",
            chosen_action_code="X",
            is_correct=True,
            ev_loss_bb=0,
        )
    with pytest.raises(ValidationError):
        PlayDecisionCreateIn(
            client_decision_id=uuid4(),
            node_path="root",
            solve_node_id=f"{SOLVE_PACK_ID}/As5h4h#0/root",
            chosen_action_code="X",
        )


def test_review_serializer_preserves_nullable_legacy_correctness() -> None:
    row = {
        "id": uuid4(),
        "verdict": "ungraded",
        "is_correct": None,
    }
    result = _decision_out(row, [], xp_earned=0)
    assert result["is_correct"] is None
    assert result["xp_earned"] == 0
    assert isinstance(result["id"], str)


class _FakeConnection:
    def __init__(self, cursor: Any) -> None:
        self._cursor = cursor
        self.commits = 0
        self.rollbacks = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return self._cursor

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


class _DuplicateDecisionCursor:
    def __init__(
        self,
        hand: dict,
        duplicate: tuple | None,
        decision: dict,
        session_status: str = "incomplete",
    ) -> None:
        self.hand = hand
        self.duplicate = duplicate
        self.decision = decision
        self.session_status = session_status
        self.calls: list[tuple[str, tuple | None]] = []
        self._one = None
        self._all: list[tuple] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql: str, params: tuple | None = None) -> None:
        normalized = " ".join(sql.split()).lower()
        self.calls.append((normalized, params))
        self._all = []
        if "select xp, streak_count, last_active_date" in normalized:
            self._one = (0, 0, None)
        elif normalized.startswith("select session_id from play_hands"):
            self._one = (self.hand["session_id"],)
        elif normalized.startswith("select status from play_sessions"):
            self._one = (self.session_status,)
        elif "from play_hands h" in normalized and "for update" in normalized:
            self._one = (self.hand,)
        elif "select id, solve_node_id, chosen_action_code" in normalized:
            self._one = self.duplicate
        elif "from play_decisions d" in normalized:
            self._one = (self.decision,)
        elif "from play_decision_actions a" in normalized:
            self._one = None
            self._all = []
        else:  # A duplicate retry must never reach a write.
            raise AssertionError(f"unexpected duplicate-route SQL: {normalized}")

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._all


def _duplicate_route_fixture(chosen_action: str = "X"):
    hand_id = uuid4()
    decision_id = uuid4()
    client_decision_id = uuid4()
    stable_hand = source_hand_id("As5h4h", 0)
    hand = {
        "id": hand_id,
        "user_id": "owner",
        "session_id": uuid4(),
        "source_hand_id": stable_hand,
        "status": "incomplete",
        "hero_position": "BB",
        "hero_cards": ["Kc", "Ts"],
        "stack_depth_bb": 100,
    }
    decision = {
        "id": decision_id,
        "hand_id": hand_id,
        "client_decision_id": client_decision_id,
        "solve_node_id": f"{stable_hand}/root",
        "chosen_action_code": chosen_action,
        "verdict": "correct",
        "is_correct": True,
    }
    duplicate = (decision_id, decision["solve_node_id"], chosen_action)
    return hand_id, client_decision_id, hand, duplicate, decision


def test_duplicate_decision_retry_returns_existing_without_attempt_or_xp(monkeypatch) -> None:
    hand_id, client_id, hand, duplicate, decision = _duplicate_route_fixture()
    cursor = _DuplicateDecisionCursor(hand, duplicate, decision)
    conn = _FakeConnection(cursor)
    monkeypatch.setattr(play_api, "get_connection", lambda: conn)

    result = play_api.create_play_decision(
        hand_id,
        PlayDecisionCreateIn(
            client_decision_id=client_id,
            node_path="root",
            chosen_action_code="X",
        ),
        "owner",
    )
    assert result["id"] == str(decision["id"])
    assert result["xp_earned"] == 0
    assert conn.commits == 1
    assert conn.rollbacks == 0
    assert not any("insert into attempts" in sql for sql, _ in cursor.calls)
    # The first lookup is explicitly owner-filtered; a foreign UUID is 404.
    hand_sql, hand_params = next(
        (sql, params)
        for sql, params in cursor.calls
        if sql.startswith("select session_id from play_hands")
    )
    assert "user_id = %s" in hand_sql
    assert hand_params == (hand_id, "owner")


def test_duplicate_decision_id_with_changed_body_is_conflict(monkeypatch) -> None:
    hand_id, client_id, hand, duplicate, decision = _duplicate_route_fixture()
    cursor = _DuplicateDecisionCursor(hand, duplicate, decision)
    conn = _FakeConnection(cursor)
    monkeypatch.setattr(play_api, "get_connection", lambda: conn)
    with pytest.raises(HTTPException) as raised:
        play_api.create_play_decision(
            hand_id,
            PlayDecisionCreateIn(
                client_decision_id=client_id,
                node_path="root",
                chosen_action_code="B18",
            ),
            "owner",
        )
    assert raised.value.status_code == 409
    assert conn.rollbacks == 1
    assert not any("insert into attempts" in sql for sql, _ in cursor.calls)


def test_incomplete_legacy_hand_cannot_append_to_abandoned_session(monkeypatch) -> None:
    hand_id, client_id, hand, _duplicate, decision = _duplicate_route_fixture()
    cursor = _DuplicateDecisionCursor(
        hand, duplicate=None, decision=decision, session_status="abandoned"
    )
    conn = _FakeConnection(cursor)
    monkeypatch.setattr(play_api, "get_connection", lambda: conn)
    with pytest.raises(HTTPException) as raised:
        play_api.create_play_decision(
            hand_id,
            PlayDecisionCreateIn(
                client_decision_id=client_id,
                node_path="root",
                chosen_action_code="X",
            ),
            "owner",
        )
    assert raised.value.status_code == 409
    assert "session" in raised.value.detail
    assert not any("insert into attempts" in sql for sql, _ in cursor.calls)


class _CompletionCursor:
    def __init__(
        self,
        hand: dict,
        decisions: list[tuple[str, str]],
        session_status: str = "incomplete",
    ) -> None:
        self.hand = hand
        self.decisions = decisions
        self.session_status = session_status
        self.calls: list[tuple[str, tuple | None]] = []
        self._one = None
        self._all: list[tuple] = []
        self.updated = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql: str, params: tuple | None = None) -> None:
        normalized = " ".join(sql.split()).lower()
        self.calls.append((normalized, params))
        self._one = None
        self._all = []
        if normalized.startswith("select session_id from play_hands"):
            self._one = (self.hand["session_id"],)
        elif normalized.startswith("select status from play_sessions"):
            self._one = (self.session_status,)
        elif "from play_hands h" in normalized and "for update" in normalized:
            self._one = (self.hand,)
        elif "select solve_node_id, chosen_action_code" in normalized:
            self._all = self.decisions
        elif normalized.startswith("update play_hands"):
            self.updated = True
            assert "runout_cards = %s" in normalized
            assert "action_history_snapshot = %s" in normalized
            self.hand = {**self.hand, "status": "completed"}
        elif normalized.startswith("update play_sessions"):
            pass
        elif "select to_jsonb(t) from play_hands" in normalized:
            self._one = (self.hand,)
        else:
            raise AssertionError(f"unexpected completion SQL: {normalized}")

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._all


def test_completed_hand_route_persists_terminal_replay_snapshot(monkeypatch) -> None:
    hand_id = uuid4()
    stable_hand = source_hand_id("As5h4h", 0)
    hand = {
        "id": hand_id,
        "user_id": "owner",
        "session_id": uuid4(),
        "source_hand_id": stable_hand,
        "status": "incomplete",
    }
    decisions = [(f"{stable_hand}/preflop", "c"), (f"{stable_hand}/root", "F")]
    cursor = _CompletionCursor(hand, decisions)
    conn = _FakeConnection(cursor)
    monkeypatch.setattr(play_api, "get_connection", lambda: conn)
    monkeypatch.setattr(
        play_api,
        "completion_snapshots",
        lambda *_args: (
            ["4s", "5d"],
            [{"type": "hero_action"}],
            {"terminal_kind": "sd"},
        ),
    )
    result = play_api.update_play_hand_status(
        hand_id, PlayStatusUpdateIn(status="completed"), "owner"
    )
    assert result["status"] == "completed"
    assert cursor.updated is True
    update_params = next(params for sql, params in cursor.calls if sql.startswith("update play_hands"))
    assert update_params[2] == ["4s", "5d"]
    assert conn.commits == 1


def test_completed_hand_route_rejects_nonterminal_without_update(monkeypatch) -> None:
    hand_id = uuid4()
    stable_hand = source_hand_id("As5h4h", 0)
    hand = {
        "id": hand_id,
        "user_id": "owner",
        "session_id": uuid4(),
        "source_hand_id": stable_hand,
        "status": "incomplete",
    }
    cursor = _CompletionCursor(hand, [(f"{stable_hand}/preflop", "c")])
    conn = _FakeConnection(cursor)
    monkeypatch.setattr(play_api, "get_connection", lambda: conn)
    monkeypatch.setattr(
        play_api,
        "completion_snapshots",
        lambda *_args: (_ for _ in ()).throw(SolveDataError("non-terminal")),
    )
    with pytest.raises(HTTPException) as raised:
        play_api.update_play_hand_status(
            hand_id, PlayStatusUpdateIn(status="completed"), "owner"
        )
    assert raised.value.status_code == 409
    assert cursor.updated is False
    assert conn.rollbacks == 1


def test_incomplete_hand_cannot_complete_under_closed_session(monkeypatch) -> None:
    hand_id = uuid4()
    stable_hand = source_hand_id("As5h4h", 0)
    hand = {
        "id": hand_id,
        "user_id": "owner",
        "session_id": uuid4(),
        "source_hand_id": stable_hand,
        "status": "incomplete",
    }
    cursor = _CompletionCursor(
        hand,
        [(f"{stable_hand}/preflop", "c")],
        session_status="abandoned",
    )
    conn = _FakeConnection(cursor)
    monkeypatch.setattr(play_api, "get_connection", lambda: conn)
    with pytest.raises(HTTPException) as raised:
        play_api.update_play_hand_status(
            hand_id, PlayStatusUpdateIn(status="completed"), "owner"
        )
    assert raised.value.status_code == 409
    assert cursor.updated is False


class _AttemptCursor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple | None]] = []
        self._one = None

    def execute(self, sql: str, params: tuple | None = None) -> None:
        normalized = " ".join(sql.split()).lower()
        self.calls.append((normalized, params))
        self._one = (42,) if "insert into attempts" in normalized else None

    def fetchone(self):
        return self._one


def test_authoritative_decision_uses_established_attempt_xp_streak_flow(monkeypatch) -> None:
    cursor = _AttemptCursor()
    monkeypatch.setattr(play_api, "today_et", lambda: datetime.date(2026, 8, 3))
    attempt_id, xp = _record_attempt_xp(
        cursor,
        "owner",
        (90, 2, datetime.date(2026, 8, 2)),
        {"verdict": "correct", "chosen_action_code": "X"},
        {"server_derived": True},
    )
    assert (attempt_id, xp) == (42, 10)
    sql = " ".join(statement for statement, _ in cursor.calls)
    assert "insert into attempts" in sql
    assert "insert into skill_stats" in sql
    assert "insert into user_daily_activity" in sql
    assert "update profiles" in sql


def test_session_idempotency_lock_precedes_lookup_and_route_writes_are_owner_scoped() -> None:
    session_source = inspect.getsource(play_api.create_play_session)
    assert session_source.index("profiles where id = %s for update") < session_source.index(
        "client_session_id = %s"
    )
    decision_source = inspect.getsource(play_api.create_play_decision)
    assert decision_source.index("_lock_profile") < decision_source.index(
        "_get_owned_hand_for_update"
    )
    hand_lock_source = inspect.getsource(play_api._get_owned_hand_for_update)
    assert hand_lock_source.index("select status from play_sessions") < hand_lock_source.index(
        "select to_jsonb(h) from play_hands"
    )
    for endpoint in (
        play_api.create_play_session,
        play_api.create_play_hand,
        play_api.create_play_decision,
        play_api.update_play_hand_status,
        play_api.update_play_session_status,
        play_api.recent_play_sessions,
        play_api.recent_play_hands,
        play_api.play_hand_review,
    ):
        assert "user_id" in inspect.getsource(endpoint)


def test_recent_aggregates_exclude_unverified_legacy_grades() -> None:
    sessions_source = inspect.getsource(play_api.recent_play_sessions)
    hands_source = inspect.getsource(play_api.recent_play_hands)
    for source in (sessions_source, hands_source):
        assert "d.grading_status in ('validated', 'reference_graded')" in source
        assert "sum(d.ev_loss_bb) filter" in source
    assert "d.verdict = 'blunder'" in hands_source
