import datetime

import pytest
from pydantic import ValidationError

from api.scenarios import (
    ScenarioSubmitIn,
    et_day_start_utc,
    scenario_xp,
)


@pytest.mark.parametrize(
    "correct,acceptable,prior,expected",
    [
        (True, False, False, 5),
        (False, True, False, 2),
        (False, False, False, 0),
        (True, False, True, 0),
        (False, True, True, 0),
    ],
)
def test_scenario_xp_is_first_attempt_only(correct, acceptable, prior, expected):
    assert scenario_xp(correct, acceptable, prior) == expected


def test_scenario_submission_validates_shape():
    assert ScenarioSubmitIn(scenario_id=1, selected_choice_id="a").scenario_id == 1
    with pytest.raises(ValidationError):
        ScenarioSubmitIn(scenario_id=0, selected_choice_id="a")
    with pytest.raises(ValidationError):
        ScenarioSubmitIn(scenario_id=1, selected_choice_id="")


def test_et_day_start_uses_new_york_not_utc_midnight():
    # Midnight July 30 in New York is 04:00 UTC during daylight time.
    got = et_day_start_utc(datetime.date(2026, 7, 30))
    assert got == datetime.datetime(
        2026, 7, 30, 4, 0, tzinfo=datetime.timezone.utc
    )
