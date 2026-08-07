"""Regression checks for the authored M4 learning-content seed."""
from __future__ import annotations

import json
import re
from pathlib import Path


SEED = Path(__file__).parents[1] / "supabase" / "seed.sql"


def seed_text() -> str:
    return SEED.read_text(encoding="utf-8")


def json_blocks(text: str) -> list[object]:
    raw_blocks = re.findall(
        r"\$json\$\s*\n(.*?)\n\s*\$json\$::jsonb", text, flags=re.DOTALL
    )
    return [json.loads(raw) for raw in raw_blocks]


def test_seed_has_the_full_authored_catalog():
    text = seed_text()
    # M4 authored 20 lessons; M8.6A added module 06 (Bluffing & Aggression),
    # lessons 21-26; M8.7E added module 07 (Short Stacks & Push/Fold), lessons
    # 27-30. The scenario/table-scenario comment counts stay at the M4 numbers
    # because neither later block uses those "-- scenario NN:" comment
    # markers; their inventory is asserted separately below.
    assert len(re.findall(r"^\s*-- lesson \d{2}:", text, flags=re.MULTILINE)) == 30
    assert len(re.findall(r"^\s*-- scenario \d{2}:", text, flags=re.MULTILINE)) == 33
    assert (
        len(re.findall(r"^\s*-- table scenario \d{2}:", text, flags=re.MULTILINE))
        == 20
    )
    for title in (
        "Foundations",
        "Preflop Basics",
        "Flop Fundamentals",
        "Counting Outs",
        "Mental Game",
        "Bluffing & Aggression",
    ):
        assert f"'{title}'" in text


def test_the_bluffing_module_is_seeded_with_practice_of_its_own():
    """M8.6A: the module must end in a decision, not a read.

    `bluff` was a shipped drill kind with one lesson behind it, so the course
    could drill a concept it never taught. These ids are explicit and stable;
    if one is reused for something else the upsert would silently rewrite the
    bluffing content.
    """
    text = seed_text()
    assert "-- M8.6A — Module 06" in text
    for lesson_id in range(21, 27):
        assert re.search(rf"^\s*{lesson_id},\n\s*6,", text, flags=re.MULTILINE), (
            f"lesson {lesson_id} is not seeded into module 6"
        )
    # Three authored scenarios and two table scenarios carry the module.
    assert text.count("'bluffing',") >= 5

    # M8.7E — module 07. Lessons only: push/fold is drilled and charted
    # rather than played out, so there is no authored table scenario for it.
    assert "'Short Stacks & Push/Fold'" in text
    for title in (
        "'When the Tree Collapses'",
        "'How Often Does a Jam Need to Work?'",
        "'Calling Off Is a Different Question'",
        "'Antes, and a Rule That Is Not Quite True'",
    ):
        assert title in text, f"module 07 lesson {title} is missing"
    # Every module 07 lesson carries the drill's own tag, or a diagnosed
    # short-stack weakness has nothing to route to.
    assert text.count('"short_stack"') >= 4


def test_every_dollar_quoted_json_value_parses():
    text = seed_text()
    blocks = json_blocks(text)
    # 97 from M4; +13 from M8.6A (6 lessons, 3 scenarios, 2 table scenarios
    # x situation_json + choices_json); +4 from M8.7E's four lessons. Empty
    # acceptable_choice_ids are seeded as SQL null, matching M4, so they add
    # no $json$ block.
    assert len(blocks) == 114
    assert text.count("$json$") == len(blocks) * 2


def test_every_authored_answer_points_to_a_real_choice():
    """Selected by SHAPE, not by position.

    This used to slice `blocks[:20]` and `blocks[20:53]`, which silently
    stopped covering anything appended after M4 — the M8.6A bluffing content
    would have been skipped entirely while the test still passed. Matching on
    structure means new authored content is checked the moment it is seeded.
    """
    blocks = json_blocks(seed_text())
    lessons = [b for b in blocks if isinstance(b, dict) and "screens" in b]
    scenarios = [b for b in blocks if isinstance(b, dict) and "evaluation" in b]

    assert len(lessons) == 30
    assert len(scenarios) == 36

    for lesson in lessons:
        assert lesson["screens"]
        for screen in lesson["screens"]:
            if screen["type"] not in {"question", "drill"}:
                continue
            choice_ids = {choice["id"] for choice in screen["choices"]}
            assert screen["correct_choice_id"] in choice_ids
            # An authored choice must never collide with the M8.5C sentinel,
            # or an honest "Not sure" would grade as a real answer.
            assert "__unsure__" not in choice_ids

    for scenario in scenarios:
        choice_ids = {choice["id"] for choice in scenario["choices"]}
        evaluation = scenario["evaluation"]
        assert evaluation["correct_choice_id"] in choice_ids
        assert set(evaluation["acceptable_choice_ids"]) <= choice_ids
        assert "__unsure__" not in choice_ids


def test_seed_is_repeatable_and_never_resets_user_data():
    text = seed_text().lower()
    # Four upserts per authored block: modules, lessons, scenarios,
    # table_scenarios. M4 contributes one set and M8.6A a second. M8.7E adds
    # two more — module 07 seeds lessons only, with no authored scenarios.
    assert text.count("on conflict (id) do update set") == 10
    assert "delete from" not in text
    assert "truncate" not in text
    assert "drop table" not in text


def test_seed_keeps_the_content_math_and_rules_corrected():
    text = seed_text()
    for expected in (
        "Required equity = 20 ÷ 120 = **16.7%**",
        '"counting_outs"',
        '"equity_estimation"',
        "$4,000–$5,000",
        "King-high straight on the board",
        "with 30% equity",
        "Range advantage supports betting frequency",
        '"pot_bb": 13.5',
        '"pot_bb": 7.5',
    ):
        assert expected in text
    for retired_error in (
        "Raise — only KK beats you",
        "as a 30% favorite",
        "top pair top kicker on a dry board against a passive player",
        "this board connects far better with CO''s range",
    ):
        assert retired_error not in text
