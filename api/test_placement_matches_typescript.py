"""The placement blueprint and its scoring rules exist on both sides (M8.5B).

The browser deals the questions from `lib/placement/blueprint.ts`; the server
decides what each answer measured and what the result means, from
`api/placement.py`. The client sends only a question INDEX, so the two lists
must agree on what lives at that index — otherwise a player's pot-odds answer
is filed under counting outs and the placement is wrong in a way nothing
reports.

The scoring constants are pinned for a subtler reason: the client shows the
player their result immediately, the server stores it. If the thresholds drift,
the screen says "starting at module 2" while the database says module 1, and
the disagreement only surfaces as a confusing landing page much later.
"""
from __future__ import annotations

import pathlib
import re

from api.placement import (
    ASSESSMENT_VERSION,
    ENTRY_HIGH,
    ENTRY_LOW,
    MAX_ENTRY_MODULE_INDEX,
    PLACED_LEVEL,
    PLACEMENT_KINDS,
    PLACEMENT_QUESTION_COUNT,
    PROBE_LEVEL,
    GENERATOR_VERSION,
)
from api.skills import skill_tag_for

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
BLUEPRINT_TS = REPO_ROOT / "lib" / "placement" / "blueprint.ts"
VERSION_TS = REPO_ROOT / "lib" / "drill" / "version.ts"


def _blueprint_source() -> str:
    return BLUEPRINT_TS.read_text()


def _typescript_blueprint() -> list[tuple[str, str]]:
    """Parse PLACEMENT_BLUEPRINT's (kind, tag) pairs, in order."""
    source = _blueprint_source()
    body = re.search(
        r"export const PLACEMENT_BLUEPRINT[^=]*=\s*\[(.*?)\n\];",
        source,
        re.S,
    )
    assert body, "PLACEMENT_BLUEPRINT is no longer an array literal"
    pairs = re.findall(
        r'\{\s*kind:\s*"([^"]+)",\s*level:\s*[^,]+,\s*tag:\s*"([^"]+)"\s*\}',
        body.group(1),
    )
    assert pairs, "no blueprint items parsed — the item shape changed"
    return pairs


def _ts_number(name: str, source: str | None = None) -> float:
    text = source if source is not None else _blueprint_source()
    match = re.search(rf"export const {name}[^=]*=\s*([0-9.]+)", text)
    assert match, f"{name} is no longer a numeric literal"
    return float(match.group(1))


def test_the_two_blueprints_list_the_same_kinds_in_the_same_order() -> None:
    ts = _typescript_blueprint()
    assert [kind for kind, _ in ts] == list(PLACEMENT_KINDS)


def test_each_index_measures_the_same_skill_on_both_sides() -> None:
    """The client sends an index; the server writes the tag. They must match."""
    for index, (kind, tag) in enumerate(_typescript_blueprint()):
        assert tag == skill_tag_for(kind), f"index {index}: {kind} -> {tag}"
        assert tag == skill_tag_for(PLACEMENT_KINDS[index])


def test_the_question_count_matches() -> None:
    assert len(_typescript_blueprint()) == PLACEMENT_QUESTION_COUNT


def test_the_versions_match() -> None:
    assert _ts_number("ASSESSMENT_VERSION") == ASSESSMENT_VERSION
    assert _ts_number("GENERATOR_VERSION", VERSION_TS.read_text()) == GENERATOR_VERSION


def test_the_probe_level_matches() -> None:
    match = re.search(
        r"export const PROBE_LEVEL[^=]*=\s*([0-9]+)", _blueprint_source()
    )
    assert match
    assert int(match.group(1)) == PROBE_LEVEL


def test_the_entry_thresholds_match() -> None:
    source = _blueprint_source()
    thresholds = re.findall(r"accuracy < ([0-9.]+)", source)
    assert [float(value) for value in thresholds] == [ENTRY_LOW, ENTRY_HIGH]


def test_the_entry_cap_matches() -> None:
    assert _ts_number("MAX_ENTRY_MODULE_INDEX") == MAX_ENTRY_MODULE_INDEX


def test_placement_can_award_at_most_the_middle_level_on_both_sides() -> None:
    assert PLACED_LEVEL == 2
    source = _blueprint_source()
    # The TypeScript expresses it as the literal earned level; anything higher
    # would let one question certify mastery.
    assert "response.correct ? 2 : 1" in source


def test_placement_writes_nothing_to_attempts_or_skill_stats() -> None:
    """The XP rule is a decision, not an accident — so it is pinned.

    Placement reusing the generic attempt path is the failure mode this guards:
    nine onboarding questions would then land in `attempts`, drag `skill_stats`
    down before the player had learned anything, and start a streak the player
    never earned.
    """
    source = (REPO_ROOT / "api" / "placement.py").read_text()
    # Matched as the executable forms — an SQL target or a call — so the
    # module's own prose about not touching these can name them freely.
    for forbidden in (
        "into attempts",
        "into skill_stats",
        "into user_daily_activity",
        "next_streak(",
        "XP_CORRECT_ANSWER",
        "update profiles",
    ):
        assert forbidden not in source, (
            f"api/placement.py contains {forbidden!r} — placement must not "
            "touch practice aggregates, XP or streaks"
        )
