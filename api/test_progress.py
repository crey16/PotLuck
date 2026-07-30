"""Unit tests for the pure product-logic helpers in api/progress.py.

Pure units only: no DB, no HTTP server, no network. These encode the
America/New_York day-boundary rule and the streak/level semantics ported
verbatim from StackSchool's `routes/progress.py::_update_streak` /
`_recalc_level`.
"""
import datetime

import pytest
from pydantic import ValidationError

from api.index import AttemptIn, DRILL_STATE_SQL, SKILL_STATS_SQL
from api.progress import next_streak, recalc_level, today_et


class TestRecalcLevel:
    @pytest.mark.parametrize(
        "xp,expected_level",
        [
            (0, 1),
            (99, 1),
            (100, 2),
            (250, 3),
        ],
    )
    def test_recalc_level(self, xp: int, expected_level: int) -> None:
        assert recalc_level(xp) == expected_level


class TestNextStreak:
    def test_first_ever_activity_starts_streak_at_one(self) -> None:
        today = datetime.date(2026, 7, 29)
        streak, last_active = next_streak(None, 0, today)
        assert streak == 1
        assert last_active == today

    def test_same_day_again_is_unchanged(self) -> None:
        today = datetime.date(2026, 7, 29)
        streak, last_active = next_streak(today, 5, today)
        assert streak == 5
        assert last_active == today

    def test_active_yesterday_increments(self) -> None:
        today = datetime.date(2026, 7, 29)
        yesterday = today - datetime.timedelta(days=1)
        streak, last_active = next_streak(yesterday, 5, today)
        assert streak == 6
        assert last_active == today

    def test_gap_of_two_or_more_days_resets_to_one(self) -> None:
        today = datetime.date(2026, 7, 29)
        two_days_ago = today - datetime.timedelta(days=2)
        streak, last_active = next_streak(two_days_ago, 10, today)
        assert streak == 1
        assert last_active == today

    def test_ny_midnight_edge_counts_as_consecutive_days(self) -> None:
        # Active at 2026-07-29 23:30 ET, then again at 2026-07-30 00:30 ET —
        # only an hour apart, but two different ET calendar days. Must be
        # treated as consecutive-day activity (+1), not a reset.
        day1 = datetime.date(2026, 7, 29)
        day2 = datetime.date(2026, 7, 30)
        streak, last_active = next_streak(day1, 3, day2)
        assert streak == 4
        assert last_active == day2


class TestTodayEt:
    def test_utc_vs_et_trap(self) -> None:
        # 2026-07-30 01:00 UTC is still 2026-07-29 in America/New_York
        # (EDT = UTC-4 in July). A naive implementation that just calls
        # .date() on a UTC datetime without converting to ET would wrongly
        # return 2026-07-30 here.
        instant = datetime.datetime(2026, 7, 30, 1, 0, tzinfo=datetime.timezone.utc)
        assert today_et(instant) == datetime.date(2026, 7, 29)

    def test_naive_datetime_is_treated_as_utc(self) -> None:
        # Same instant as above but supplied without tzinfo.
        instant = datetime.datetime(2026, 7, 30, 1, 0)
        assert today_et(instant) == datetime.date(2026, 7, 29)

    def test_ny_midnight_edge_via_today_et_feeds_next_streak(self) -> None:
        # The same NY-midnight edge as TestNextStreak, but derived end-to-end
        # from UTC instants through today_et() -> next_streak(), the way a
        # request handler actually would. This is the real trap: if today_et
        # used UTC dates directly, instant_a and instant_b would both/neither
        # land on the same UTC day depending on the naive bug, producing the
        # wrong streak transition.
        instant_a = datetime.datetime(2026, 7, 30, 3, 30, tzinfo=datetime.timezone.utc)  # 2026-07-29 23:30 ET
        instant_b = datetime.datetime(2026, 7, 30, 4, 30, tzinfo=datetime.timezone.utc)  # 2026-07-30 00:30 ET

        day1 = today_et(instant_a)
        day2 = today_et(instant_b)
        assert day1 == datetime.date(2026, 7, 29)
        assert day2 == datetime.date(2026, 7, 30)

        streak, last_active = next_streak(day1, 3, day2)
        assert streak == 4
        assert last_active == day2

    def test_today_et_with_no_argument_returns_a_date(self) -> None:
        result = today_et()
        assert isinstance(result, datetime.date)


def test_attempt_in_rejects_an_unknown_drill_kind():
    with pytest.raises(ValidationError):
        AttemptIn(drill_kind="nonsense", drill_payload={}, answer="9", is_correct=True)


def test_attempt_in_accepts_every_real_drill_kind():
    from api.skills import DRILL_KINDS
    for kind in DRILL_KINDS:
        got = AttemptIn(drill_kind=kind, drill_payload={}, answer="9", is_correct=True)
        assert got.drill_kind == kind


def test_attempt_in_caps_the_answer_length():
    with pytest.raises(ValidationError):
        AttemptIn(drill_kind="outs", drill_payload={}, answer="x" * 300, is_correct=True)


def test_skill_stats_sql_increments_rather_than_overwriting():
    sql = " ".join(SKILL_STATS_SQL.split())
    assert "on conflict (user_id, skill_tag) do update" in sql.lower()
    # the increment must come from the existing row, never a read-modify-write
    assert "skill_stats.total_attempts + 1" in sql
    assert "skill_stats.correct_attempts + excluded.correct_attempts" in sql


def test_drill_state_sql_windows_the_last_ten_per_kind():
    sql = " ".join(DRILL_STATE_SQL.split()).lower()
    assert "row_number() over (partition by drill_kind" in sql
    assert "order by created_at desc, id desc" in sql
    assert "rn <= 10" in sql
    assert "drill_kind is not null" in sql
    # RLS is belt; the explicit predicate is braces
    assert "user_id = %s" in sql
    # The outer order must be oldest-first (rn desc), not newest-first
    # (rn asc). pushResult on the client appends new results at the end, so
    # the client treats the returned array as oldest -> newest; reversing
    # this order would silently corrupt every downstream
    # pushResult/nextLevel call without changing anything else observable
    # here (same rows, same set membership, just backwards).
    assert "order by drill_kind, rn desc" in sql
