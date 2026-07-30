from api.skills import DRILL_KINDS, SKILL_TAGS, skill_tag_for


def test_every_drill_kind_has_a_tag():
    assert set(SKILL_TAGS) == set(DRILL_KINDS)


def test_nine_kinds():
    assert len(DRILL_KINDS) == 9


def test_existing_stackschool_tags_are_reused_verbatim():
    # These tags already exist on lessons/scenarios, so drill and lesson
    # accuracy pool into one skill_stats row and M4's recommendations work.
    assert SKILL_TAGS["potodds"] == "pot_odds"
    assert SKILL_TAGS["decision"] == "pot_odds"
    assert SKILL_TAGS["bluff"] == "bluffing"
    assert SKILL_TAGS["concepts"] == "discipline"
    assert SKILL_TAGS["preflop"] == "hand_selection"


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
