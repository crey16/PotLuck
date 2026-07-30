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
    assert len(re.findall(r"^\s*-- lesson \d{2}:", text, flags=re.MULTILINE)) == 20
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
    ):
        assert f"'{title}'" in text


def test_every_dollar_quoted_json_value_parses():
    text = seed_text()
    blocks = json_blocks(text)
    assert len(blocks) == 97
    assert text.count("$json$") == len(blocks) * 2


def test_every_authored_answer_points_to_a_real_choice():
    blocks = json_blocks(seed_text())
    lessons = blocks[:20]
    scenarios = blocks[20:53]

    for lesson in lessons:
        assert isinstance(lesson, dict)
        assert lesson["screens"]
        for screen in lesson["screens"]:
            if screen["type"] not in {"question", "drill"}:
                continue
            choice_ids = {choice["id"] for choice in screen["choices"]}
            assert screen["correct_choice_id"] in choice_ids

    for scenario in scenarios:
        assert isinstance(scenario, dict)
        choice_ids = {choice["id"] for choice in scenario["choices"]}
        evaluation = scenario["evaluation"]
        assert evaluation["correct_choice_id"] in choice_ids
        assert set(evaluation["acceptable_choice_ids"]) <= choice_ids


def test_seed_is_repeatable_and_never_resets_user_data():
    text = seed_text().lower()
    assert text.count("on conflict (id) do update set") == 4
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
