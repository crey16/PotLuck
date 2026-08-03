"""Friend search + request lifecycle logic.

The SQL around these decisions is thin; the decisions themselves — the
guard cascade, auto-accept, relationship precedence, LIKE escaping — are
pure functions tested here, in the house style of test_daily/test_scenarios.
Auth behaviour (401 without a token) is already pinned by test_deps.py for
every endpoint using current_user_id.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from api.friends import (
    RELATIONSHIPS,
    REQUEST_STATUSES,
    FriendRequestIn,
    FriendRespondIn,
    decide_friend_request,
    escape_like_prefix,
    relationship_of,
)


def test_vocabularies_are_pinned():
    assert REQUEST_STATUSES == ("pending", "accepted", "declined")
    assert RELATIONSHIPS == ("none", "friends", "pending_outgoing", "pending_incoming")


@pytest.mark.parametrize(
    "is_friend,pending_out,pending_in,expected",
    [
        (False, False, False, "none"),
        (True, False, False, "friends"),
        (False, True, False, "pending_outgoing"),
        (False, False, True, "pending_incoming"),
        # Precedence: an existing friendship outranks any stale request rows,
        # and an outgoing request outranks a simultaneous incoming one.
        (True, True, True, "friends"),
        (False, True, True, "pending_outgoing"),
    ],
)
def test_relationship_precedence(is_friend, pending_out, pending_in, expected):
    assert relationship_of(is_friend, pending_out, pending_in) == expected


def test_like_prefix_escapes_wildcards():
    assert escape_like_prefix("Al") == "al%"
    assert escape_like_prefix("a_b") == r"a\_b%"
    assert escape_like_prefix("100%") == r"100\%%"
    assert escape_like_prefix(r"a\b") == "a\\\\b%"


@pytest.mark.parametrize(
    "kwargs,expected",
    [
        # Guard cascade, in order.
        (dict(is_self=True), "reject_self"),
        (dict(target_exists=False), "not_found"),
        (dict(already_friends=True), "conflict_friends"),
        (dict(pending_outgoing=True), "conflict_pending"),
        (dict(pending_reverse=True), "auto_accept"),
        (dict(), "create"),
        # Order matters: self beats everything, missing target beats friends.
        (dict(is_self=True, already_friends=True), "reject_self"),
        (dict(target_exists=False, pending_reverse=True), "not_found"),
        (dict(already_friends=True, pending_reverse=True), "conflict_friends"),
        (dict(pending_outgoing=True, pending_reverse=True), "conflict_pending"),
    ],
)
def test_friend_request_guard_cascade(kwargs, expected):
    defaults = dict(
        is_self=False,
        target_exists=True,
        already_friends=False,
        pending_outgoing=False,
        pending_reverse=False,
    )
    defaults.update(kwargs)
    assert decide_friend_request(**defaults) == expected


def test_request_body_validates_shape():
    assert FriendRequestIn(to_user_id="u2").to_user_id == "u2"
    with pytest.raises(ValidationError):
        FriendRequestIn(to_user_id="")


def test_respond_body_validates_action():
    assert FriendRespondIn(request_id=1, action="accept").action == "accept"
    assert FriendRespondIn(request_id=1, action="decline").action == "decline"
    with pytest.raises(ValidationError):
        FriendRespondIn(request_id=1, action="reject")
    with pytest.raises(ValidationError):
        FriendRespondIn(request_id=0, action="accept")
