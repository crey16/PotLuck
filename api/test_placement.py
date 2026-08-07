"""Pure M8.5B placement scoring and request validation.

Pure units only: no DB, no HTTP server. The routes are thin wrappers over the
functions exercised here plus SQL, and the scoring is the part that decides
where a real player starts the course.
"""
import pytest
from pydantic import ValidationError

from api.placement import (
    ASSESSMENT_VERSION,
    BASE_LEVEL,
    ENTRY_HIGH,
    ENTRY_LOW,
    MAX_ENTRY_MODULE_INDEX,
    PLACED_LEVEL,
    PLACEMENT_KINDS,
    PLACEMENT_QUESTION_COUNT,
    PlacementFinishIn,
    PlacementResponseIn,
    PlacementStartIn,
    entry_module_index,
    placement_accuracy,
    placement_levels,
    tag_scores,
)
from api.skills import DRILL_KINDS, skill_tag_for


def responses(pattern: str):
    """'c' correct, 'w' wrong, 'u' unsure — one character per question."""
    return [
        (index, char == "c", char == "u") for index, char in enumerate(pattern)
    ]


# ---------- the blueprint ----------


def test_the_blueprint_covers_every_drill_kind_once():
    assert sorted(PLACEMENT_KINDS) == sorted(DRILL_KINDS)
    assert len(set(PLACEMENT_KINDS)) == len(PLACEMENT_KINDS)


def test_the_blueprint_length_is_inside_the_target_range():
    assert 8 <= PLACEMENT_QUESTION_COUNT <= 12


def test_the_blueprint_covers_every_canonical_skill_tag():
    tags = {skill_tag_for(kind) for kind in PLACEMENT_KINDS}
    assert tags == {
        "bluffing",
        "counting_outs",
        "discipline",
        "equity_estimation",
        "expected_value",
        "hand_selection",
        "implied_odds",
        "pot_odds",
        # M8.7E. Kept apart from hand_selection on purpose: 100bb opening
        # ranges and 12bb jam/fold are genuinely different skills.
        "short_stack",
    }


# ---------- per-tag scores ----------


def test_every_tag_is_present_even_with_no_responses():
    scores = tag_scores([])
    assert len(scores) == 9
    assert all(score["asked"] == 0 for score in scores.values())


def test_pot_odds_accumulates_both_of_its_drill_kinds():
    potodds = PLACEMENT_KINDS.index("potodds")
    decision = PLACEMENT_KINDS.index("decision")
    scores = tag_scores([(potodds, True, False), (decision, False, False)])
    assert scores["pot_odds"]["asked"] == 2
    assert scores["pot_odds"]["correct"] == 1


def test_an_unsure_answer_is_counted_apart_from_a_wrong_one():
    outs = PLACEMENT_KINDS.index("outs")
    scores = tag_scores([(outs, False, True)])
    assert scores["counting_outs"] == {
        "tag": "counting_outs", "asked": 1, "correct": 0, "unsure": 1
    }


def test_an_unsure_answer_can_never_also_count_as_correct():
    outs = PLACEMENT_KINDS.index("outs")
    scores = tag_scores([(outs, True, True)])
    assert scores["counting_outs"]["correct"] == 0
    assert scores["counting_outs"]["unsure"] == 1


def test_a_response_outside_the_blueprint_is_ignored():
    scores = tag_scores([(99, True, False), (-1, True, False)])
    assert all(score["asked"] == 0 for score in scores.values())


# ---------- starting difficulty ----------


def test_a_correct_answer_places_that_drill_one_level_up():
    assert placement_levels([(0, True, False)])[PLACEMENT_KINDS[0]] == PLACED_LEVEL


def test_a_wrong_or_unsure_answer_places_at_the_base_level():
    assert placement_levels([(0, False, False)])[PLACEMENT_KINDS[0]] == BASE_LEVEL
    # Saying "Not sure" must never be the profitable answer, including here
    # where the reward for a miss would be easier questions.
    assert placement_levels([(0, True, True)])[PLACEMENT_KINDS[0]] == BASE_LEVEL


def test_placement_can_never_award_the_top_level():
    levels = placement_levels(responses("c" * PLACEMENT_QUESTION_COUNT))
    assert set(levels) == set(PLACEMENT_KINDS)
    assert all(level <= PLACED_LEVEL for level in levels.values())
    assert PLACED_LEVEL < 3


def test_an_unanswered_kind_is_absent_rather_than_defaulted():
    levels = placement_levels([(0, True, False)])
    assert list(levels) == [PLACEMENT_KINDS[0]]


# ---------- entry module ----------


@pytest.mark.parametrize(
    "pattern,expected",
    [
        ("wwwwwwwww", 0),      # 0%
        ("cccwwwwww", 0),      # 33%, below ENTRY_LOW
        ("ccccwwwww", 1),      # 44%
        ("ccccccwww", 1),      # 67%, below ENTRY_HIGH
        ("cccccccww", 2),      # 78%
        ("ccccccccc", 2),      # 100%
        ("uuuuuuuuu", 0),      # every answer unsure
    ],
)
def test_entry_module_index_follows_the_settled_thresholds(pattern, expected):
    assert entry_module_index(responses(pattern)) == expected


def test_entry_module_index_is_capped_however_perfect_the_result():
    assert entry_module_index(responses("c" * 40)) == MAX_ENTRY_MODULE_INDEX
    assert MAX_ENTRY_MODULE_INDEX == 2


def test_an_abandoned_assessment_places_nobody():
    assert entry_module_index([]) == 0


def test_the_thresholds_are_the_settled_stackschool_ones():
    from api.learning import difficulty_for_accuracy

    # difficulty_for_accuracy uses < 0.40 and < 0.75; placement reuses them so
    # there is one accuracy vocabulary rather than a third set of cut-offs.
    assert (ENTRY_LOW, ENTRY_HIGH) == (0.40, 0.75)
    assert difficulty_for_accuracy(39, 100) == 1
    assert difficulty_for_accuracy(74, 100) == 2
    assert difficulty_for_accuracy(75, 100) == 3


def test_accuracy_counts_unsure_answers_against():
    assert placement_accuracy(responses("cccc")) == 1.0
    assert placement_accuracy(responses("ccww")) == 0.5
    assert placement_accuracy(responses("ccuu")) == 0.5
    assert placement_accuracy([]) == 0.0


# ---------- the skip path ----------


def test_the_skip_path_lands_exactly_on_the_cold_start():
    """A skipped assessment must change nothing about where a player starts."""
    assert entry_module_index([]) == 0
    assert placement_levels([]) == {}
    assert all(score["asked"] == 0 for score in tag_scores([]).values())


# ---------- request validation ----------


def test_a_response_must_point_at_a_real_question():
    ok = PlacementResponseIn(
        assessment_id=1, question_index=0, is_correct=True, answer="9"
    )
    assert ok.response_type == "answer"
    with pytest.raises(ValidationError):
        PlacementResponseIn(
            assessment_id=1,
            question_index=PLACEMENT_QUESTION_COUNT,
            is_correct=True,
            answer="9",
        )
    with pytest.raises(ValidationError):
        PlacementResponseIn(
            assessment_id=1, question_index=-1, is_correct=True, answer="9"
        )


def test_a_response_rejects_an_unknown_response_type():
    with pytest.raises(ValidationError):
        PlacementResponseIn(
            assessment_id=1,
            question_index=0,
            is_correct=False,
            answer="x",
            response_type="maybe",
        )


def test_a_start_seed_stays_inside_the_rng_space():
    assert PlacementStartIn(seed=0).seed == 0
    assert PlacementStartIn(seed=2**31 - 1).seed == 2**31 - 1
    with pytest.raises(ValidationError):
        PlacementStartIn(seed=-1)
    with pytest.raises(ValidationError):
        PlacementStartIn(seed=2**31)


def test_finish_requests_validate_their_assessment_id():
    assert PlacementFinishIn(assessment_id=3).assessment_id == 3
    with pytest.raises(ValidationError):
        PlacementFinishIn(assessment_id=0)


def test_the_assessment_version_is_a_positive_integer():
    assert isinstance(ASSESSMENT_VERSION, int) and ASSESSMENT_VERSION > 0
