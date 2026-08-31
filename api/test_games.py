"""Home-game tracker logic (M15, docs/19).

House style of test_friends.py: the SQL is thin, the decisions are pure
functions tested here. The settlement algorithms live ONLY in this module —
the TypeScript side displays stored transfers and never recomputes them —
so these tests are the whole correctness story for who-pays-whom.
"""
from __future__ import annotations

import pytest

from api.games import (
    ENTRY_KINDS,
    INVITE_ALPHABET,
    SETTLEMENT_MODES,
    banker_transfers,
    can_manage,
    direction_for_kind,
    fewest_transfers,
    ledger_balance,
    new_invite_code,
    player_nets,
    title_case_name,
)


def test_vocabularies_are_pinned():
    assert ENTRY_KINDS == ("buyin", "rebuy", "addon", "cashout")
    assert SETTLEMENT_MODES == ("banker", "fewest_transfers")


def test_invite_codes_avoid_lookalikes_and_are_long_enough():
    for ch in "0O1IL":
        assert ch not in INVITE_ALPHABET
    codes = {new_invite_code() for _ in range(50)}
    assert len(codes) == 50  # no trivial collisions
    for code in codes:
        assert len(code) == 10
        assert all(ch in INVITE_ALPHABET for ch in code)


@pytest.mark.parametrize(
    "role,expected",
    [("owner", True), ("admin", True), ("member", False), (None, False)],
)
def test_can_manage(role, expected):
    assert can_manage(role) is expected


def test_title_case_name_normalises_the_sheet_caps():
    assert title_case_name("VISHNU") == "Vishnu"
    assert title_case_name("MARY JO") == "Mary Jo"
    assert title_case_name("  sahil ") == "Sahil"
    # SAHIL and SAHIR stay distinct — normalisation never merges names.
    assert title_case_name("SAHIL") != title_case_name("SAHIR")


@pytest.mark.parametrize(
    "kind,direction",
    [("buyin", "in"), ("rebuy", "in"), ("addon", "in"), ("cashout", "out")],
)
def test_direction_is_derived_from_kind(kind, direction):
    assert direction_for_kind(kind) == direction


# ---------------------------------------------------------------------
# Ledger math
# ---------------------------------------------------------------------

def test_player_nets_out_minus_in():
    entries = [
        ("a", "in", 6000),
        ("a", "in", 10000),
        ("a", "out", 20000),
        ("b", "in", 6000),
        ("b", "out", 2000),
    ]
    assert player_nets(entries) == {"a": 4000, "b": -4000}


def test_ledger_balance_zero_iff_balanced():
    assert ledger_balance([("a", "in", 6000), ("a", "out", 6000)]) == 0
    # $20 more paid in than out: positive balance, the sign says which way.
    assert ledger_balance([("a", "in", 6000), ("a", "out", 4000)]) == 2000


def _assert_squares(nets: dict[str, int], transfers: list[tuple[str, str, int]]):
    """Replaying the transfers must leave every player exactly at zero."""
    remaining = dict(nets)
    for frm, to, amount in transfers:
        assert amount > 0
        assert frm != to
        remaining[frm] = remaining.get(frm, 0) + amount
        remaining[to] = remaining.get(to, 0) - amount
    assert all(v == 0 for v in remaining.values()), remaining


NETS = {"a": 30000, "b": -20000, "c": -10000, "d": 0}


def test_banker_transfers_all_flow_through_the_banker():
    transfers = banker_transfers(NETS, "c")
    _assert_squares(NETS, transfers)
    assert all("c" in (frm, to) for frm, to, _ in transfers)
    # d is square and gets no transfer; the banker's own net settles
    # implicitly, so at most n-1 transfers.
    assert len(transfers) == 2
    assert ("b", "c", 20000) in transfers
    assert ("c", "a", 30000) in transfers


def test_banker_with_zero_net_banker():
    nets = {"bank": 0, "w": 5000, "l": -5000}
    transfers = banker_transfers(nets, "bank")
    _assert_squares(nets, transfers)
    assert len(transfers) == 2


def test_fewest_transfers_greedy_matches_largest_pair():
    transfers = fewest_transfers(NETS)
    _assert_squares(NETS, transfers)
    assert transfers == [("b", "a", 20000), ("c", "a", 10000)]


def test_fewest_transfers_zero_net_players_are_untouched():
    transfers = fewest_transfers({"x": 0, "y": 0})
    assert transfers == []


def test_fewest_transfers_single_player_and_empty():
    assert fewest_transfers({}) == []
    assert fewest_transfers({"a": 0}) == []


def test_fewest_transfers_deterministic_on_ties():
    nets = {"b": -5000, "a": -5000, "w": 10000}
    # Equal debtors: pid ascending breaks the tie, every run identical.
    assert fewest_transfers(nets) == [("a", "w", 5000), ("b", "w", 5000)]


def test_fewest_transfers_squares_a_messy_table():
    nets = {"a": 12250, "b": -200, "c": -12050, "d": 7300, "e": -7300}
    transfers = fewest_transfers(nets)
    _assert_squares(nets, transfers)
    # Never more transfers than non-zero players minus one.
    assert len(transfers) <= 4
