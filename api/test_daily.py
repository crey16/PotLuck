import datetime

import pytest
from fastapi import HTTPException

from api.daily import _require_completed_daily_item, daily_content_index


class ScriptedCursor:
    def __init__(self, responses):
        self.responses = list(responses)
        self.current = None

    def execute(self, *_args):
        self.current = self.responses.pop(0)

    def fetchone(self):
        return self.current

    def fetchall(self):
        return self.current


def test_daily_selection_is_deterministic_for_a_date_and_pool():
    day = datetime.date(2026, 7, 30)
    assert daily_content_index(day, 20) == daily_content_index(day, 20)


def test_daily_selection_stays_inside_pool():
    for offset in range(100):
        day = datetime.date(2026, 1, 1) + datetime.timedelta(days=offset)
        assert 0 <= daily_content_index(day, 7) < 7


def test_daily_selection_rejects_empty_pool():
    with pytest.raises(ValueError):
        daily_content_index(datetime.date(2026, 7, 30), 0)


def test_daily_lesson_accepts_a_completion_written_today():
    day = datetime.date(2026, 7, 30)
    completed_at = datetime.datetime(2026, 7, 30, 12, tzinfo=datetime.timezone.utc)
    cursor = ScriptedCursor([(completed_at, {"screens": []})])
    _require_completed_daily_item(cursor, "user", day, "lesson", 4, None)


def test_daily_lesson_replay_requires_every_authored_check_today():
    day = datetime.date(2026, 7, 30)
    old = datetime.datetime(2026, 7, 29, 12, tzinfo=datetime.timezone.utc)
    content = {
        "screens": [
            {"type": "question"},
            {"type": "info"},
            {"type": "drill"},
        ]
    }
    complete = ScriptedCursor([(old, content), [(0, False), (2, True)]])
    _require_completed_daily_item(complete, "user", day, "lesson", 4, None)

    incomplete = ScriptedCursor([(old, content), [(0, False), (2, False)]])
    with pytest.raises(HTTPException) as error:
        _require_completed_daily_item(incomplete, "user", day, "lesson", 4, None)
    assert error.value.status_code == 409


def test_daily_scenario_requires_an_attempt_today():
    day = datetime.date(2026, 7, 30)
    _require_completed_daily_item(
        ScriptedCursor([(1,)]), "user", day, "scenario", None, 9
    )
    with pytest.raises(HTTPException) as error:
        _require_completed_daily_item(
            ScriptedCursor([None]), "user", day, "scenario", None, 9
        )
    assert error.value.status_code == 409
