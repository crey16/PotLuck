"""Pin the social vocabulary across Python and TypeScript.

`api/friends.py` declares REQUEST_STATUSES and RELATIONSHIPS; so does
`lib/social/types.ts`. A drifted value fails softly at runtime (a button
renders the wrong state, a status string never matches), so — as with
test_drill_kinds_match_typescript.py — pytest parses the TypeScript side.
"""
from __future__ import annotations

import pathlib
import re

from api.friends import RELATIONSHIPS, REQUEST_STATUSES

TYPES_TS = pathlib.Path(__file__).resolve().parent.parent / "lib" / "social" / "types.ts"


def _typescript_tuple(name: str) -> tuple[str, ...]:
    source = TYPES_TS.read_text()
    match = re.search(
        rf"export const {name}\s*=\s*\[(.*?)\]\s*as const", source, re.DOTALL
    )
    assert match, f"{name} not found in lib/social/types.ts"
    return tuple(re.findall(r'"([^"]+)"', match.group(1)))


def test_request_statuses_match():
    assert _typescript_tuple("REQUEST_STATUSES") == REQUEST_STATUSES


def test_relationships_match():
    assert _typescript_tuple("RELATIONSHIPS") == RELATIONSHIPS
