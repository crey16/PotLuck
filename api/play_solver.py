"""Immutable M6 solve-pack loading and server-authoritative play grading.

The browser identifies only a pack hand, node, and chosen action.  This module
loads the checked-in solve data and derives every coaching field stored by M8.
It deliberately does not import or duplicate the TypeScript reference ranges:
``solver/gen-play-catalog.ts`` publishes their frequencies into catalog.json.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

SOLVE_PACK_ID = "potluck:m6:srp-btn-bb:v1"
SOLUTION_PROFILE_ID = "cash-6max-chip-ev"
SOLUTION_VERSION = "m6-v1"
PACK_GRADING_VERSION = "play-grade:v1"
PREFLOP_GRADING_VERSION = "reference-ranges:v1"
SPOT = "srp-btn-bb"

_ROOT = Path(__file__).resolve().parents[1]
_SOLVE_DIR = _ROOT / "public" / "solves" / SPOT
_FLOP_RE = re.compile(r"^(?:[2-9TJQKA][shdc]){3}$")
_PATH_RE = re.compile(r"^(?:root|preflop|\d+(?:\.\d+)*)$")
_SOURCE_HAND_RE = re.compile(
    rf"^{re.escape(SOLVE_PACK_ID)}/((?:[2-9TJQKA][shdc]){{3}})#(\d+)$"
)

# Keep these integer thresholds identical to lib/play/verdict.ts.  Losses are
# encoded in 0.05bb steps and frequencies as 0..255.
_CORRECT_MAX = 2
_MIX_FREQ_MIN = 51
_ACCEPTABLE_MAX = 10
_INACCURACY_MAX = 14
_EV_STEP_BB = 0.05
_PREFLOP_MIX_MIN = 0.2


class SolveDataError(ValueError):
    """A client reference is not present in the immutable solve pack."""


def _content_hash_from_inputs(
    catalog: dict[str, Any],
    manifest_bytes: bytes,
    solve_file_bytes: Iterable[bytes],
) -> str:
    """Mirror solver/gen-play-catalog.ts over caller-supplied immutable bytes."""
    digest = hashlib.sha256()
    digest.update(manifest_bytes)
    for solve_bytes in solve_file_bytes:
        digest.update(solve_bytes)
    canonical_metadata = {
        key: value for key, value in catalog.items() if key != "content_hash"
    }
    # Compact separators and insertion order match JSON.stringify.  The
    # generated catalog is ASCII-only, but ensure_ascii=False also matches JS
    # should future metadata contain Unicode.
    digest.update(
        json.dumps(
            canonical_metadata,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf8")
    )
    return f"sha256:{digest.hexdigest()}"


def compute_pack_content_hash(catalog: dict[str, Any]) -> str:
    """Recompute the checked-in pack digest in manifest order."""
    manifest_bytes = (_SOLVE_DIR / "index.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    solve_bytes = [
        (_SOLVE_DIR / f"{entry['flop']}.json").read_bytes()
        for entry in manifest["flops"]
    ]
    return _content_hash_from_inputs(catalog, manifest_bytes, solve_bytes)


def pack_availability() -> dict[str, Any]:
    """Report whether the immutable pack is readable in this runtime.

    Vercel serves ``public/`` as Next.js static assets, which are not part of
    the Python function bundle; ``vercel.json`` must include the solve files
    explicitly.  A missing bundle is an operational fault, not a client error,
    so surface it directly instead of as an opaque 500.
    """
    manifest_path = _SOLVE_DIR / "index.json"
    catalog_path = _SOLVE_DIR / "catalog.json"
    listed = 0
    if manifest_path.is_file():
        try:
            listed = sum(
                1
                for entry in json.loads(manifest_path.read_bytes())["flops"]
                if (_SOLVE_DIR / f"{entry['flop']}.json").is_file()
            )
        except (ValueError, KeyError, OSError):
            listed = -1
    status: dict[str, Any] = {
        "solve_dir_present": _SOLVE_DIR.is_dir(),
        "manifest_present": manifest_path.is_file(),
        "catalog_present": catalog_path.is_file(),
        "solve_files_present": listed,
        "verified": False,
    }
    if not _SOLVE_DIR.is_dir():
        # Name what the bundle actually contains so a packaging fault can be
        # fixed without serverless log access.
        try:
            status["bundle_root"] = str(_ROOT)
            status["bundle_entries"] = sorted(p.name for p in _ROOT.iterdir())[:40]
        except OSError as exc:
            status["bundle_entries"] = f"{type(exc).__name__}: {exc}"
    try:
        catalog = load_catalog()
    except Exception as exc:  # surfaced to an authenticated caller only
        status["error"] = f"{type(exc).__name__}: {exc}"
        return status
    status["verified"] = True
    status["solve_pack_id"] = catalog["id"]
    status["content_hash"] = catalog["content_hash"]
    return status


@lru_cache(maxsize=1)
def load_catalog() -> dict[str, Any]:
    catalog = json.loads((_SOLVE_DIR / "catalog.json").read_text("utf8"))
    expected = {
        "id": SOLVE_PACK_ID,
        "spot": SPOT,
        "solution_profile_id": SOLUTION_PROFILE_ID,
        "solution_version": SOLUTION_VERSION,
        "format_version": 1,
        "grading_version": PACK_GRADING_VERSION,
    }
    for key, value in expected.items():
        if catalog.get(key) != value:
            raise RuntimeError(f"solve catalog {key} mismatch")
    if compute_pack_content_hash(catalog) != catalog.get("content_hash"):
        raise RuntimeError("solve pack content hash mismatch")
    return catalog


@lru_cache(maxsize=1)
def load_manifest() -> dict[str, Any]:
    manifest = json.loads((_SOLVE_DIR / "index.json").read_text("utf8"))
    if manifest.get("spot") != SPOT:
        raise RuntimeError("solve manifest spot mismatch")
    return manifest


@lru_cache(maxsize=6)
def load_solve(flop: str) -> dict[str, Any]:
    if not _FLOP_RE.fullmatch(flop):
        raise SolveDataError("invalid flop id")
    counts = {entry["flop"]: entry["instances"] for entry in load_manifest()["flops"]}
    if flop not in counts:
        raise SolveDataError("flop is not in this solve pack")
    solve = json.loads((_SOLVE_DIR / f"{flop}.json").read_text("utf8"))
    if solve.get("spot") != SPOT or solve.get("flop") != flop:
        raise RuntimeError("solve file metadata mismatch")
    if len(solve.get("instances", [])) != counts[flop]:
        raise RuntimeError("solve instance count mismatch")
    return solve


def source_hand_id(flop: str, instance_index: int) -> str:
    """Return the globally stable hand id after validating the reference."""
    solve = load_solve(flop)
    if instance_index < 0 or instance_index >= len(solve["instances"]):
        raise SolveDataError("instance index is outside this solve file")
    return f"{SOLVE_PACK_ID}/{flop}#{instance_index}"


def parse_source_hand_id(value: str) -> tuple[str, int]:
    match = _SOURCE_HAND_RE.fullmatch(value)
    if not match:
        raise SolveDataError("source_hand_id is not from the current solve pack")
    flop, raw_index = match.groups()
    index = int(raw_index)
    # Validate both membership and bounds rather than merely parsing the id.
    source_hand_id(flop, index)
    return flop, index


def get_hand(flop: str, instance_index: int) -> tuple[dict[str, Any], dict[str, Any]]:
    solve = load_solve(flop)
    if instance_index < 0 or instance_index >= len(solve["instances"]):
        raise SolveDataError("instance index is outside this solve file")
    return solve, solve["instances"][instance_index]


def node_suffix(node_path: str) -> str:
    if not _PATH_RE.fullmatch(node_path):
        raise SolveDataError("invalid solve node path")
    return node_path


def stable_node_id(stable_hand_id: str, node_path: str) -> str:
    node_suffix(node_path)
    return f"{stable_hand_id}/{node_path}"


def parse_stable_node_id(stable_hand_id: str, value: str) -> str:
    prefix = f"{stable_hand_id}/"
    if not value.startswith(prefix):
        raise SolveDataError("solve_node_id does not belong to this hand")
    return node_suffix(value[len(prefix) :])


def hand_notation(hand: str) -> str:
    ranks = "23456789TJQKA"
    if len(hand) != 4:
        raise SolveDataError("invalid hero hand")
    rank_a, suit_a, rank_b, suit_b = hand
    if rank_a == rank_b:
        return rank_a + rank_b
    if ranks.index(rank_a) < ranks.index(rank_b):
        rank_a, rank_b = rank_b, rank_a
    return rank_a + rank_b + ("s" if suit_a == suit_b else "o")


def postflop_verdict(frequency_u8: int, loss_steps: int) -> str:
    if loss_steps <= _CORRECT_MAX:
        return "correct"
    if frequency_u8 >= _MIX_FREQ_MIN and loss_steps <= _ACCEPTABLE_MAX:
        return "acceptable"
    if loss_steps <= _INACCURACY_MAX:
        return "inaccuracy"
    return "blunder"


def is_right_verdict(verdict: str) -> bool:
    return verdict in {"correct", "acceptable"}


def _action_parts(code: str) -> tuple[str, float | None, str]:
    simple = {
        "X": ("check", None, "Check"),
        "F": ("fold", None, "Fold"),
        "C": ("call", None, "Call"),
        "r": ("raise", None, "Raise"),
        "c": ("call", None, "Call"),
        "f": ("fold", None, "Fold"),
    }
    if code in simple:
        return simple[code]
    match = re.fullmatch(r"([BRA])(\d+)", code)
    if not match:
        raise SolveDataError(f"invalid action code {code!r}")
    prefix, raw_amount = match.groups()
    kind = {"B": "bet", "R": "raise", "A": "all_in"}[prefix]
    amount = int(raw_amount) / 10
    label = f"{kind.replace('_', ' ').title()} to {amount:g}bb"
    return kind, amount, label


def _rank_value(card: str) -> int:
    return "--23456789TJQKA".index(card[0])


def board_texture(cards: list[str]) -> str:
    ranks = [card[0] for card in cards]
    suits = [card[1] for card in cards]
    rank_counts = Counter(ranks)
    if max(rank_counts.values(), default=1) >= 3:
        pairing = "trips"
    elif 2 in rank_counts.values():
        pairing = "paired"
    else:
        pairing = "unpaired"
    suit_count = max(Counter(suits).values(), default=1)
    if suit_count >= 3:
        suitedness = "monotone"
    elif suit_count == 2:
        suitedness = "two-tone"
    else:
        suitedness = "rainbow"
    unique_values = sorted({_rank_value(card) for card in cards})
    connected = len(unique_values) >= 3 and unique_values[-1] - unique_values[0] <= 4
    return f"{pairing}_{suitedness}_{'connected' if connected else 'disconnected'}"


def _has_straight(values: Iterable[int]) -> bool:
    unique = set(values)
    if 14 in unique:
        unique.add(1)
    ordered = sorted(unique)
    return any(
        ordered[index + 4] - ordered[index] == 4
        for index in range(max(0, len(ordered) - 4))
    )


def hand_class(hero_hand: str, board: list[str]) -> str:
    cards = [hero_hand[:2], hero_hand[2:], *board]
    ranks = Counter(card[0] for card in cards)
    suits = Counter(card[1] for card in cards)
    counts = sorted(ranks.values(), reverse=True)
    flush = max(suits.values(), default=0) >= 5
    straight = _has_straight(_rank_value(card) for card in cards)
    if counts and counts[0] == 4:
        return "four_of_a_kind"
    if counts and counts[0] >= 3 and len(counts) > 1 and counts[1] >= 2:
        return "full_house"
    if flush:
        return "flush"
    if straight:
        return "straight"
    if counts and counts[0] == 3:
        return "three_of_a_kind"
    if sum(1 for count in counts if count >= 2) >= 2:
        return "two_pair"
    if counts and counts[0] == 2:
        return "one_pair"
    return "high_card"


def _prefixes(path: str) -> list[str]:
    if path == "root":
        return [""]
    parts = path.split(".")
    return ["", *(".".join(parts[:index]) for index in range(1, len(parts) + 1))]


def board_at_node(flop: str, instance: dict[str, Any], path: str) -> list[str]:
    board = [flop[index : index + 2] for index in range(0, len(flop), 2)]
    internal_path = "" if path == "root" else path
    if internal_path not in instance["nodes"]:
        raise SolveDataError("node is not present in this hand")
    for prefix in _prefixes(path):
        node = instance["nodes"].get(prefix)
        if node is None:
            raise SolveDataError("node path is not internally connected")
        board.extend(step["v"] for step in node["pre"] if step["t"] == "c")
    return board


def _preflop_grade(
    stable_hand_id: str,
    instance: dict[str, Any],
    chosen_action: str,
) -> dict[str, Any]:
    position = "BTN" if instance["hero"] == 1 else "BB"
    scenario = load_catalog()["preflop"][position]
    notation = hand_notation(instance["hand"])
    frequencies = scenario["hands"].get(notation)
    if not frequencies or chosen_action not in frequencies:
        raise SolveDataError("chosen action is not available at this preflop node")
    action_codes = [entry["code"] for entry in scenario["actions"]]
    best = max(action_codes, key=lambda code: frequencies[code])
    chosen_frequency = float(frequencies[chosen_action])
    if chosen_action == best:
        verdict = "correct"
    elif chosen_frequency >= _PREFLOP_MIX_MIN:
        verdict = "acceptable"
    else:
        verdict = "blunder"
    labels = {entry["code"]: entry["label"] for entry in scenario["actions"]}
    actions = []
    for ordinal, code in enumerate(action_codes):
        kind, amount_bb, fallback_label = _action_parts(code)
        actions.append(
            {
                "action_code": code,
                "ordinal": ordinal,
                "action_label": labels.get(code, fallback_label),
                "action_kind": kind,
                "amount_bb": amount_bb,
                "frequency": float(frequencies[code]),
                # Reference ranges contain frequencies, not action EVs.
                "ev_bb": None,
                "ev_delta_bb": None,
                "ev_loss_bb": None,
                "is_chosen": code == chosen_action,
            }
        )
    return {
        "solve_node_id": stable_node_id(stable_hand_id, "preflop"),
        "node_path": "preflop",
        "decision_index": 0,
        "street": "preflop",
        "board_cards": [],
        "board_texture": "preflop",
        "hand_class": notation,
        "action_context": {
            "scenario_id": scenario["scenario_id"],
            "notation": notation,
            "facing_action": "unopened" if position == "BTN" else "btn_open_2.5bb",
            "available_action_codes": action_codes,
        },
        "chosen_action_code": chosen_action,
        "grading_source": "reference",
        "grading_status": "reference_graded",
        "grading_version": PREFLOP_GRADING_VERSION,
        "ev_basis": "unknown",
        "chosen_frequency": chosen_frequency,
        "chosen_ev_bb": None,
        "best_ev_bb": None,
        "ev_loss_bb": None,
        "verdict": verdict,
        "alternatives_complete": True,
        "actions": actions,
    }


def _postflop_grade(
    stable_hand_id: str,
    solve: dict[str, Any],
    instance: dict[str, Any],
    path: str,
    chosen_action: str,
) -> dict[str, Any]:
    internal_path = "" if path == "root" else path
    node = instance["nodes"].get(internal_path)
    if node is None:
        raise SolveDataError("node is not present in this hand")
    try:
        chosen_index = node["a"].index(chosen_action)
    except ValueError as exc:
        raise SolveDataError("chosen action is not available at this node") from exc
    if not (len(node["a"]) == len(node["f"]) == len(node["l"])):
        raise RuntimeError("solve node action vectors are inconsistent")

    board = board_at_node(solve["flop"], instance, path)
    hero = int(instance["hero"])
    opponent = 1 - hero
    to_call_chips = max(0, node["tb"][opponent] - node["tb"][hero])
    pot_chips = solve["pot"] + node["tb"][0] + node["tb"][1]
    actions = []
    for ordinal, (code, frequency_u8, loss_steps) in enumerate(
        zip(node["a"], node["f"], node["l"], strict=True)
    ):
        kind, amount_bb, label = _action_parts(code)
        loss_bb = round(loss_steps * _EV_STEP_BB, 4)
        actions.append(
            {
                "action_code": code,
                "ordinal": ordinal,
                "action_label": label,
                "action_kind": kind,
                "amount_bb": amount_bb,
                "frequency": round(frequency_u8 / 255, 8),
                # The M6 export has relative losses but no absolute node EV.
                "ev_bb": None,
                "ev_delta_bb": -loss_bb,
                "ev_loss_bb": loss_bb,
                "is_chosen": ordinal == chosen_index,
            }
        )
    chosen_loss_steps = int(node["l"][chosen_index])
    chosen_loss_bb = round(chosen_loss_steps * _EV_STEP_BB, 4)
    return {
        "solve_node_id": stable_node_id(stable_hand_id, path),
        "node_path": path,
        "decision_index": 1 if path == "root" else path.count(".") + 2,
        "street": ("flop", "turn", "river")[int(node["st"])],
        "board_cards": board,
        "board_texture": board_texture(board),
        "hand_class": hand_class(instance["hand"], board),
        "action_context": {
            "pot_bb": round(pot_chips / 10, 2),
            "to_call_bb": round(to_call_chips / 10, 2),
            "hero_in_position": hero == 1,
            "facing_bet": to_call_chips > 0,
            "total_bets_chips": node["tb"],
            "equity": round(node["eq"] / 255, 6),
            "available_action_codes": list(node["a"]),
            "script_before_decision": list(node["pre"]),
        },
        "chosen_action_code": chosen_action,
        "grading_source": "solver",
        "grading_status": "validated",
        "grading_version": PACK_GRADING_VERSION,
        "ev_basis": "relative_to_best",
        "chosen_frequency": round(node["f"][chosen_index] / 255, 8),
        "chosen_ev_bb": None,
        "best_ev_bb": None,
        "ev_loss_bb": chosen_loss_bb,
        "verdict": postflop_verdict(node["f"][chosen_index], chosen_loss_steps),
        "alternatives_complete": True,
        "actions": actions,
    }


def grade_decision(
    flop: str,
    instance_index: int,
    node_path: str,
    chosen_action: str,
) -> dict[str, Any]:
    """Resolve and grade one decision entirely from immutable pack data."""
    node_suffix(node_path)
    solve, instance = get_hand(flop, instance_index)
    stable_hand_id = source_hand_id(flop, instance_index)
    if node_path == "preflop":
        return _preflop_grade(stable_hand_id, instance, chosen_action)
    return _postflop_grade(stable_hand_id, solve, instance, node_path, chosen_action)


def next_node_or_end(
    flop: str,
    instance_index: int,
    decisions: Iterable[tuple[str, str]],
) -> tuple[str | None, dict[str, Any] | None]:
    """Validate an ordered saved path and return its next node or terminal.

    ``decisions`` holds stable solve_node_id + chosen_action_code.  Preflop is
    required first but does not affect the scripted postflop branch.
    """
    _, instance = get_hand(flop, instance_index)
    stable_hand_id = source_hand_id(flop, instance_index)
    rows = list(decisions)
    if not rows:
        return stable_node_id(stable_hand_id, "preflop"), None

    first_node, first_action = rows[0]
    if first_node != stable_node_id(stable_hand_id, "preflop"):
        raise SolveDataError("preflop must be the first saved decision")
    # Re-grade to validate that the saved action belongs to this hand.
    _preflop_grade(stable_hand_id, instance, first_action)

    path = ""
    for stable_id, action in rows[1:]:
        suffix = "root" if path == "" else path
        if stable_id != stable_node_id(stable_hand_id, suffix):
            raise SolveDataError("saved decisions do not follow the solve branch")
        node = instance["nodes"].get(path)
        if node is None or action not in node["a"]:
            raise SolveDataError("saved action is not available on the solve branch")
        action_index = node["a"].index(action)
        path = str(action_index) if not path else f"{path}.{action_index}"

    if path in instance["ends"]:
        end = dict(instance["ends"][path])
        end["path"] = path
        return None, end
    if path in instance["nodes"]:
        suffix = "root" if path == "" else path
        return stable_node_id(stable_hand_id, suffix), None
    raise SolveDataError("saved decisions end outside the solve tree")


def completion_snapshots(
    flop: str,
    instance_index: int,
    decisions: Iterable[tuple[str, str]],
) -> tuple[list[str], list[dict[str, Any]], dict[str, Any]]:
    """Freeze a complete branch into runout, ordered history, and result.

    The normalized decision rows remain authoritative for coaching review;
    this denormalized snapshot makes a completed hand independently replayable
    even if the UI's state machine changes later.
    """
    solve, instance = get_hand(flop, instance_index)
    stable_hand_id = source_hand_id(flop, instance_index)
    rows = list(decisions)
    next_node, terminal = next_node_or_end(flop, instance_index, rows)
    if next_node is not None or terminal is None:
        raise SolveDataError("cannot snapshot a non-terminal hand")

    runout_cards: list[str] = []
    history: list[dict[str, Any]] = []
    preflop_action = rows[0][1]
    history.append(
        {
            "type": "hero_decision",
            "street": "preflop",
            "position": "BTN" if instance["hero"] == 1 else "BB",
            "solve_node_id": stable_node_id(stable_hand_id, "preflop"),
            "chosen_action_code": preflop_action,
        }
    )
    # The M6 instance always starts postflop from BTN open 2.5bb / BB call.
    # Keep that actual line distinct from the reference-range answer above,
    # because an off-line preflop choice is graded but the prototype still
    # continues down this scripted branch.
    history.extend(
        [
            {
                "type": "player_action",
                "street": "preflop",
                "position": "BTN",
                "actor": "hero" if instance["hero"] == 1 else "opponent",
                "action_code": "R25",
                "action_kind": "raise",
                "amount_to_bb": 2.5,
                "source": "scripted_line",
            },
            {
                "type": "player_action",
                "street": "preflop",
                "position": "BB",
                "actor": "hero" if instance["hero"] == 0 else "opponent",
                "action_code": "C",
                "action_kind": "call",
                "amount_to_bb": 2.5,
                "amount_added_bb": 1.5,
                "source": "scripted_line",
            },
        ]
    )

    path = ""
    street_names = ("flop", "turn", "river")

    def append_steps(steps: list[dict[str, str]]) -> None:
        for step in steps:
            if step["t"] == "c":
                runout_cards.append(step["v"])
                history.append(
                    {
                        "type": "deal_card",
                        "street": street_names[min(2, len(runout_cards))],
                        "card": step["v"],
                    }
                )
            else:
                history.append(
                    {
                        "type": "opponent_action",
                        "street": street_names[min(2, len(runout_cards))],
                        "action_code": step["v"],
                    }
                )

    for stable_id, action in rows[1:]:
        suffix = "root" if path == "" else path
        node = instance["nodes"][path]
        append_steps(node["pre"])
        history.append(
            {
                "type": "hero_action",
                "street": street_names[int(node["st"])],
                "solve_node_id": stable_id,
                "action_code": action,
            }
        )
        action_index = node["a"].index(action)
        path = str(action_index) if not path else f"{path}.{action_index}"

    end = instance["ends"][path]
    append_steps(end["pre"])
    result = {
        "terminal_path": path,
        "terminal_kind": end["k"],
        "total_bets_chips": list(end["tb"]),
        "final_board_cards": [
            flop[index : index + 2] for index in range(0, len(flop), 2)
        ]
        + runout_cards,
        "pot_chips": solve["pot"] + end["tb"][0] + end["tb"][1],
    }
    return runout_cards, history, result
