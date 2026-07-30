"""Pure M4 lesson/recommendation rules and request validation."""
import pytest
from pydantic import ValidationError

from api.learning import (
    DEFAULT_LESSON_XP,
    LessonAttemptIn,
    LessonCompleteIn,
    answerable_screen_indices,
    difficulty_for_accuracy,
    grade_lesson_screen,
    lesson_attempt_score,
    lesson_skill_tags,
    lesson_xp_reward,
)


CONTENT = {
    "screens": [
        {"type": "info", "content": "Read this"},
        {
            "type": "question",
            "content": "Pick one",
            "choices": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],
            "correct_choice_id": "b",
        },
    ],
    "skill_tags": ["pot_odds", "pot_odds", " position ", "", 12],
    "xp_reward": 15,
}


def test_lesson_attempt_requires_positive_ids_and_a_choice():
    with pytest.raises(ValidationError):
        LessonAttemptIn(lesson_id=0, screen_index=1, selected_choice_id="b")
    with pytest.raises(ValidationError):
        LessonAttemptIn(lesson_id=1, screen_index=-1, selected_choice_id="b")
    with pytest.raises(ValidationError):
        LessonAttemptIn(lesson_id=1, screen_index=1, selected_choice_id="")


def test_lesson_complete_only_accepts_a_lesson_id():
    assert LessonCompleteIn(lesson_id=2).lesson_id == 2
    with pytest.raises(ValidationError):
        LessonCompleteIn(lesson_id=0)
    with pytest.raises(ValidationError):
        LessonCompleteIn(lesson_id=2, score=100)


def test_lesson_score_uses_the_first_server_graded_try_per_screen():
    content = {
        "screens": [
            CONTENT["screens"][0],
            CONTENT["screens"][1],
            {
                "type": "drill",
                "content": "Again",
                "choices": [{"id": "a", "label": "A"}],
                "correct_choice_id": "a",
            },
        ]
    }
    assert answerable_screen_indices(content) == [1, 2]
    assert lesson_attempt_score(content, [(1, False), (1, True), (2, True)]) == (
        50,
        [],
    )
    assert lesson_attempt_score(content, [(2, True)]) == (50, [1])
    assert lesson_attempt_score(content, [(1, False), (2, False)]) == (0, [2])
    assert lesson_attempt_score({"screens": []}, []) == (100, [])


def test_grade_lesson_screen_is_server_authoritative():
    correct, tags = grade_lesson_screen(CONTENT, 1, "b")
    assert correct is True
    assert tags == ["pot_odds", "position"]
    assert grade_lesson_screen(CONTENT, 1, "a")[0] is False


@pytest.mark.parametrize("index", [0, 2])
def test_grade_rejects_non_answerable_or_missing_screens(index: int):
    with pytest.raises(ValueError):
        grade_lesson_screen(CONTENT, index, "a")


def test_grade_rejects_a_choice_not_authored_on_the_screen():
    with pytest.raises(ValueError):
        grade_lesson_screen(CONTENT, 1, "z")


def test_skill_tags_are_sanitized_and_deduplicated():
    assert lesson_skill_tags(CONTENT) == ["pot_odds", "position"]
    assert lesson_skill_tags(None) == []


def test_lesson_reward_is_read_from_content_and_bounded():
    assert lesson_xp_reward(CONTENT) == 15
    assert lesson_xp_reward({"xp_reward": 1000}) == 100
    assert lesson_xp_reward({"xp_reward": -5}) == 0
    assert lesson_xp_reward({"xp_reward": True}) == DEFAULT_LESSON_XP
    assert lesson_xp_reward({"xp_reward": "10"}) == DEFAULT_LESSON_XP
    assert lesson_xp_reward(None) == DEFAULT_LESSON_XP


@pytest.mark.parametrize(
    "correct,total,expected",
    [(0, 0, 1), (1, 5, 1), (2, 5, 2), (3, 4, 3), (74, 100, 2), (75, 100, 3)],
)
def test_recommendation_difficulty_thresholds(correct: int, total: int, expected: int):
    assert difficulty_for_accuracy(correct, total) == expected
