"""The "Not sure" sentinel is declared on both sides of the wire (M8.5C).

`lib/drill/contract.ts` exports `UNSURE`; `api/progress.py` has
`UNSURE_CHOICE_ID`. The browser sends the TypeScript value as
`selected_choice_id` (lesson, scenario and table-scenario submissions) or as
`answer` + `response_type` (drills), and the Python value decides whether to
skip the "is this choice on the screen?" membership check.

If the two drift, an honest "I don't know" on any authored screen becomes a
422 — `grade_lesson_screen` raises "choice is not present on this screen" —
and the drill path silently stores the shrug as a normal wrong answer that
then demotes the player's difficulty. Neither failure raises anywhere near
the declaration, so it is pinned here.

Same direction as test_drill_kinds_match_typescript.py, for the same reason:
pytest already has the Python side as real modules, so only the TypeScript
needs parsing.
"""
from __future__ import annotations

import pathlib
import re

from api.progress import UNSURE_CHOICE_ID, is_unsure_choice

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTRACT_TS = REPO_ROOT / "lib" / "drill" / "contract.ts"
DIFFICULTY_TS = REPO_ROOT / "lib" / "drill" / "difficulty.ts"


def _typescript_unsure() -> str:
    """Parse `export const UNSURE = "__unsure__";` out of contract.ts."""
    source = CONTRACT_TS.read_text()
    match = re.search(r'export const UNSURE\s*=\s*"([^"]+)"', source)
    assert match, "UNSURE is no longer declared as a string literal in contract.ts"
    return match.group(1)


def test_sentinel_matches_typescript() -> None:
    assert UNSURE_CHOICE_ID == _typescript_unsure()


def test_is_unsure_choice_matches_only_the_sentinel() -> None:
    assert is_unsure_choice(UNSURE_CHOICE_ID)
    for other in ("call", "fold", "raise", "unsure", "__unsure", "", "9"):
        assert not is_unsure_choice(other)


def test_typescript_response_type_union_matches_the_column_check() -> None:
    """`ResponseType` must be exactly the two values the CHECK constraint allows."""
    source = CONTRACT_TS.read_text()
    match = re.search(r'export type ResponseType\s*=\s*([^;]+);', source)
    assert match, "ResponseType is no longer declared in contract.ts"
    values = set(re.findall(r'"([^"]+)"', match.group(1)))
    assert values == {"answer", "unsure"}

    migration = (
        REPO_ROOT / "supabase" / "migrations" / "0005_m85_not_sure.sql"
    ).read_text()
    check = re.search(
        r"response_type\s+text\s+not null\s+default\s+'answer'\s*"
        r"check\s*\(response_type in \(([^)]+)\)\)",
        migration,
    )
    assert check, "the response_type CHECK constraint is no longer parseable"
    assert set(re.findall(r"'([^']+)'", check.group(1))) == values


def test_difficulty_excludes_unsure_on_both_sides() -> None:
    """`pushOutcome` drops unsure answers; DRILL_STATE_SQL must do the same.

    They reconstruct the same window — one live, one after a reload. If only
    one applies the filter, a player's difficulty silently changes when they
    refresh the page, which reads as a bug in the drill rather than in a SQL
    predicate.
    """
    from api.index import DRILL_STATE_SQL

    assert "response_type = 'answer'" in DRILL_STATE_SQL

    ts = DIFFICULTY_TS.read_text()
    assert 'if (grade === "unsure") return window;' in ts, (
        "pushOutcome no longer short-circuits on unsure — DRILL_STATE_SQL's "
        "response_type filter would then disagree with the live session"
    )
