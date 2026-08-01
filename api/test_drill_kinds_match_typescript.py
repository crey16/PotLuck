"""The nine drill kinds are declared in three places; nothing tied the
TypeScript declaration to the Python ones until this file.

`lib/drill/contract.ts` has `DRILL_KINDS`. `api/index.py`'s `AttemptIn` has a
`Literal`. `api/skills.py` has `SKILL_TAGS` plus its own `DRILL_KINDS`. The
existing `api/test_skills.py` ties the two Python lists together — this ties
Python to TypeScript.

Why it matters, and why the failure is silent rather than loud: adding a tenth
kind gives a compile error from `GENERATORS`' total `Record` (good), but the
`Literal` does not follow, so the API answers 422. `lib/drill/recordAttempt.ts`
treats a non-OK response as fail-soft — `console.warn` and return null — so XP,
streaks, daily activity and skill stats all stop recording for that kind while
the UI keeps showing the session Score going up. Nothing throws and no test
fails.

Implemented as a pytest that reads the TypeScript rather than a tsx test that
reads the Python, for one reason: pytest already imports the Python side as
real modules, so only one side needs parsing. The reverse would have to parse
both a `Literal` and a dict literal out of Python source with regexes.
"""
from __future__ import annotations

import pathlib
import re

from api.index import AttemptIn, DRILL_WINDOW_SIZE
from api.skills import ATTEMPT_KINDS, DRILL_KINDS, SKILL_TAGS

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTRACT_TS = REPO_ROOT / "lib" / "drill" / "contract.ts"
DIFFICULTY_TS = REPO_ROOT / "lib" / "drill" / "difficulty.ts"


def _typescript_drill_kinds() -> set[str]:
    """Parse `export const DRILL_KINDS: DrillKind[] = [...]` out of contract.ts."""
    source = CONTRACT_TS.read_text()
    match = re.search(
        r"export const DRILL_KINDS\s*:\s*DrillKind\[\]\s*=\s*\[(.*?)\]",
        source,
        re.S,
    )
    assert match, f"could not find DRILL_KINDS in {CONTRACT_TS}"
    return set(re.findall(r'"([a-z0-9_]+)"', match.group(1)))


def _typescript_attempt_kinds() -> set[str]:
    """ATTEMPT_KINDS is `[...DRILL_KINDS, ...extras]` — parse the extras."""
    source = CONTRACT_TS.read_text()
    match = re.search(
        r"export const ATTEMPT_KINDS\s*:\s*AttemptKind\[\]\s*=\s*\[(.*?)\]",
        source,
        re.S,
    )
    assert match, f"could not find ATTEMPT_KINDS in {CONTRACT_TS}"
    body = match.group(1)
    assert "...DRILL_KINDS" in body, "ATTEMPT_KINDS must spread DRILL_KINDS"
    return _typescript_drill_kinds() | set(re.findall(r'"([a-z0-9_]+)"', body))


def _typescript_window_size() -> int:
    source = DIFFICULTY_TS.read_text()
    match = re.search(r"export const WINDOW_SIZE\s*=\s*(\d+)", source)
    assert match, f"could not find WINDOW_SIZE in {DIFFICULTY_TS}"
    return int(match.group(1))


def test_typescript_and_python_agree_on_the_drill_kinds():
    assert _typescript_drill_kinds() == set(DRILL_KINDS)


def test_typescript_and_python_agree_on_the_attempt_kinds():
    """The attempt vocabulary is the nine drills plus the play mode."""
    assert _typescript_attempt_kinds() == set(ATTEMPT_KINDS)
    assert set(ATTEMPT_KINDS) == set(DRILL_KINDS) | {"play"}


def test_the_attempt_literal_accepts_exactly_the_typescript_kinds():
    """A kind the client can generate but the API rejects means XP silently
    stops recording for it, because recordAttempt swallows the 422."""
    ts_kinds = _typescript_attempt_kinds()
    for kind in ts_kinds:
        got = AttemptIn(drill_kind=kind, drill_payload={}, answer="x", is_correct=True)
        assert got.drill_kind == kind

    literal_kinds = set(AttemptIn.model_fields["drill_kind"].annotation.__args__)
    assert literal_kinds == ts_kinds


def test_every_typescript_kind_has_a_skill_tag():
    """Without a tag, skill_tag_for raises KeyError inside the attempt
    transaction and the whole write 500s."""
    assert _typescript_attempt_kinds() == set(SKILL_TAGS)


def test_typescript_and_python_agree_on_the_window_size():
    """If these drift, the server returns one window length while the client
    slices to another — silently truncating or under-filling, with no error."""
    assert _typescript_window_size() == DRILL_WINDOW_SIZE
