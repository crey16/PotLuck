"""Pure product-logic helpers for XP/level/streak.

No DB, no HTTP, no FastAPI imports here — importable and unit-testable in
isolation. Ported verbatim (semantics) from StackSchool's
`routes/progress.py::_update_streak` / `_recalc_level`
(~/PycharmProjects/PokerDuolingo/backend/app/routes/progress.py), with the
day boundary confined to exactly one function: `today_et`.
"""
from __future__ import annotations

import datetime
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")

# M8.5C: the choice id a client sends for "Not sure".  Authored content —
# lessons, scenarios, table scenarios — is graded by matching the submitted id
# against the screen's own choices, so the sentinel has to be recognised before
# that membership check or an honest "I don't know" would 422.
#
# Must equal `UNSURE` in lib/drill/contract.ts; test_unsure_matches_typescript.py
# pins the two together.  Namespaced because authored choice ids are short
# hand-written strings like "call" or "fold".
UNSURE_CHOICE_ID = "__unsure__"


def is_unsure_choice(selected_choice_id: str) -> bool:
    """True when the player said they did not know rather than choosing."""
    return selected_choice_id == UNSURE_CHOICE_ID


def graded_correct(is_correct: bool, response_type: str) -> bool:
    """Re-grade a client-reported result against its response type.

    "Not sure" is never correct, however the request describes it. Deciding
    that here rather than trusting `is_correct` means no call site can earn XP
    for a shrug, and a stored attempt can never contradict its response_type.
    """
    return False if response_type == "unsure" else is_correct


def today_et(now: datetime.datetime | None = None) -> datetime.date:
    """The current date in America/New_York — the ONLY place day boundaries
    are computed.

    `now` is injectable for testing. If it is timezone-aware, it is converted
    to ET. If it is naive, it is assumed to be UTC (matches how timestamps
    typically arrive from the DB / `datetime.utcnow()`-style call sites). If
    omitted, uses the real current time.
    """
    if now is None:
        now = datetime.datetime.now(datetime.timezone.utc)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=datetime.timezone.utc)
    return now.astimezone(ET).date()


def et_day_start_utc(day: datetime.date) -> datetime.datetime:
    """Return midnight at the product's ET day boundary as a UTC instant."""
    return datetime.datetime.combine(day, datetime.time.min, tzinfo=ET).astimezone(
        datetime.timezone.utc
    )


def recalc_level(xp: int) -> int:
    """Denormalised level from XP. The ONE consolidated place this is
    computed — StackSchool had this duplicated across three routes."""
    return (xp // 100) + 1


def next_streak(
    last_active_date: datetime.date | None,
    streak_count: int,
    today: datetime.date,
) -> tuple[int, datetime.date]:
    """Compute the next (streak_count, last_active_date) pair.

    Semantics (verbatim port of StackSchool's `_update_streak`):
      - same ET day as last activity -> unchanged
      - exactly one ET day since last activity -> streak += 1
      - anything else (including never active before) -> streak resets to 1
    In all cases except "same day", last_active_date becomes `today`.
    """
    if last_active_date == today:
        return streak_count, last_active_date

    yesterday = today - datetime.timedelta(days=1)
    if last_active_date == yesterday:
        return streak_count + 1, today

    return 1, today
