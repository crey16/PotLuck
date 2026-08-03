"""Profile PATCH validation and update-clause assembly."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from api.profile import ProfilePatchIn, patch_columns


def test_display_name_is_trimmed_and_bounded():
    assert ProfilePatchIn(display_name="  Al  ").display_name == "Al"
    with pytest.raises(ValidationError):
        ProfilePatchIn(display_name="   ")
    with pytest.raises(ValidationError):
        ProfilePatchIn(display_name="x" * 41)
    assert ProfilePatchIn(display_name="x" * 40).display_name == "x" * 40


def test_bio_bounds_and_clearing():
    assert ProfilePatchIn(bio="hello").bio == "hello"
    # Empty string clears the bio (stored as null).
    assert ProfilePatchIn(bio="").bio == ""
    with pytest.raises(ValidationError):
        ProfilePatchIn(bio="x" * 281)
    assert len(ProfilePatchIn(bio="x" * 280).bio) == 280


def test_unknown_fields_are_rejected():
    with pytest.raises(ValidationError):
        ProfilePatchIn(username="newname")
    with pytest.raises(ValidationError):
        ProfilePatchIn(xp=99999)


def test_patch_columns_requires_at_least_one_field():
    with pytest.raises(ValueError):
        patch_columns(ProfilePatchIn())


def test_patch_columns_builds_only_provided_fields():
    cols, values = patch_columns(ProfilePatchIn(display_name="Al", is_public=False))
    assert cols == ["display_name = %s", "is_public = %s"]
    assert values == ["Al", False]


def test_patch_columns_stores_empty_bio_as_null():
    cols, values = patch_columns(ProfilePatchIn(bio=""))
    assert cols == ["bio = %s"]
    assert values == [None]
