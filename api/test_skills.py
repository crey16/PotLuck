from api.skills import ATTEMPT_KINDS, DRILL_KINDS, SKILL_TAGS, skill_tag_for


def test_every_attempt_kind_has_a_tag():
    assert set(SKILL_TAGS) == set(ATTEMPT_KINDS)


def test_attempt_kinds_are_the_drills_plus_play():
    assert set(ATTEMPT_KINDS) == set(DRILL_KINDS) | {"play"}


def test_ten_kinds():
    # Ten since M8.7E added short-stack jam/fold. The count is asserted rather
    # than derived so adding a kind is a deliberate act in three files at once
    # — this list, the TypeScript contract, and the AttemptIn literal.
    assert len(DRILL_KINDS) == 10


def test_existing_stackschool_tags_are_reused_verbatim():
    # These tags already exist on lessons/scenarios, so drill and lesson
    # accuracy pool into one skill_stats row and M4's recommendations work.
    assert SKILL_TAGS["potodds"] == "pot_odds"
    assert SKILL_TAGS["decision"] == "pot_odds"
    assert SKILL_TAGS["bluff"] == "bluffing"
    assert SKILL_TAGS["concepts"] == "discipline"
    assert SKILL_TAGS["preflop"] == "hand_selection"


def test_short_stack_is_its_own_tag_not_hand_selection():
    # Deliberately separate: a player can have excellent 100bb opening ranges
    # and no idea what to do at 12bb. Pooling them would hide exactly that gap
    # from the recommendations, which is the gap worth finding.
    assert SKILL_TAGS["pushfold"] == "short_stack"
    assert SKILL_TAGS["pushfold"] != SKILL_TAGS["preflop"]


def test_new_tags_for_kinds_with_no_existing_home():
    assert SKILL_TAGS["outs"] == "counting_outs"
    assert SKILL_TAGS["rule24"] == "equity_estimation"
    assert SKILL_TAGS["implied"] == "implied_odds"
    assert SKILL_TAGS["ev"] == "expected_value"


def test_tags_are_snake_case_identifiers():
    for tag in SKILL_TAGS.values():
        assert tag == tag.lower()
        assert tag.replace("_", "").isalpha()


def test_skill_tag_for_rejects_an_unknown_kind():
    try:
        skill_tag_for("nonsense")
    except KeyError:
        return
    raise AssertionError("skill_tag_for must raise KeyError on an unknown kind")
