"""The ONE drill_kind -> skill_tag map.

Kept server-side only and deliberately absent from the drill contract, so the
browser can never report a tag it got wrong: it sends drill_kind, we derive
the tag.

Where StackSchool already has a tag that genuinely matches, we reuse it, so
drill accuracy and lesson accuracy accumulate on the same skill_stats row and
M4's recommendations can route a botched pot-odds drill to the pot-odds
lesson. Four kinds have no existing home and get new tags; M4 must tolerate a
weakest tag with no lesson behind it.
"""
from __future__ import annotations

SKILL_TAGS: dict[str, str] = {
    # reused from StackSchool's vocabulary
    "potodds": "pot_odds",
    "decision": "pot_odds",   # "call or fold" IS a pot-odds question
    "bluff": "bluffing",
    "concepts": "discipline",
    "preflop": "hand_selection",
    # new
    "outs": "counting_outs",
    "rule24": "equity_estimation",
    "implied": "implied_odds",
    "ev": "expected_value",
    # M8.7E short-stack jam/fold. Its own tag rather than hand_selection:
    # a player can have excellent 100bb opening ranges and no idea what to do
    # at 12bb, and folding those together would hide exactly that gap from
    # the recommendations.
    "pushfold": "short_stack",
    # M6 play mode — one attempt per postflop decision
    "play": "postflop_play",
}

DRILL_KINDS: tuple[str, ...] = (
    "outs", "rule24", "potodds", "decision", "implied",
    "ev", "bluff", "concepts", "preflop", "pushfold",
)

# The ten drills plus the play mode: everything AttemptIn accepts.
# Mirrors ATTEMPT_KINDS in lib/drill/contract.ts.
ATTEMPT_KINDS: tuple[str, ...] = DRILL_KINDS + ("play",)


def skill_tag_for(kind: str) -> str:
    """The canonical skill tag for a drill kind. Raises KeyError if unknown."""
    return SKILL_TAGS[kind]
