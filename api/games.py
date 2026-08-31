"""Home game tracker (M15, docs/19): groups, roster, sessions, ledger,
settlement.

Every write in the feature goes through here on the pooled service
connection, one transaction per request — RLS on the games tables grants
members SELECT and nothing else (migration 0010), exactly like `friends`.
Reads for the UI go direct from Supabase and live only in
lib/games/queries.ts.

Money is integer cents. Net is always derived from session_entries at the
moment it is needed. The settlement algorithms live ONLY in this module:
the client displays stored transfers and never recomputes them, so there
is exactly one implementation to be wrong.

STRICT SEPARATION: nothing in this file touches XP, streaks, skill_stats,
attempts, play_* or any coaching aggregate, and nothing ever may —
real-money results are not evidence about decision quality.
"""
from __future__ import annotations

import secrets
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from api.db import get_connection
from api.deps import current_user_id

router = APIRouter()

ENTRY_KINDS = ("buyin", "rebuy", "addon", "cashout")
SETTLEMENT_MODES = ("banker", "fewest_transfers")

# No 0/O/1/I/L — codes get read out loud across a poker table.
INVITE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

MAX_ENTRY_CENTS = 10_000_000  # $100k per single event is already absurd


def new_invite_code() -> str:
    return "".join(secrets.choice(INVITE_ALPHABET) for _ in range(10))


def can_manage(role: str | None) -> bool:
    return role in ("owner", "admin")


def title_case_name(name: str) -> str:
    """The sheet's ALL-CAPS names, display-cased. Pure formatting — it must
    never be used to match or merge players (SAHIL and SAHIR are one letter
    apart and are different people)."""
    return " ".join(part.capitalize() for part in name.split())


def direction_for_kind(kind: str) -> str:
    """Derived server-side so the client can never file a cash-out as money
    entering the pot."""
    return "out" if kind == "cashout" else "in"


# ---------------------------------------------------------------------
# Ledger math (pure)
# ---------------------------------------------------------------------

Entry = tuple[str, str, int]  # (player_id, direction, amount_cents)


def player_nets(entries: list[Entry]) -> dict[str, int]:
    """Net cents per player: out - in. Voided rows are filtered upstream."""
    nets: dict[str, int] = {}
    for player_id, direction, amount in entries:
        delta = amount if direction == "out" else -amount
        nets[player_id] = nets.get(player_id, 0) + delta
    return nets


def ledger_balance(entries: list[Entry]) -> int:
    """Total in minus total out. Zero iff the table balances; the sign says
    which way it is off."""
    return sum(a if d == "in" else -a for _, d, a in entries)


Transfer = tuple[str, str, int]  # (from_player_id, to_player_id, amount_cents)


def banker_transfers(nets: dict[str, int], banker: str) -> list[Transfer]:
    """How the group runs today: every loser pays the banker, every winner
    is paid by the banker. The banker's own net settles implicitly through
    the flows, so at most n-1 transfers. Deterministic: biggest first, then
    player id."""
    transfers: list[Transfer] = []
    for pid in sorted(nets, key=lambda p: (-abs(nets[p]), p)):
        if pid == banker:
            continue
        net = nets[pid]
        if net < 0:
            transfers.append((pid, banker, -net))
        elif net > 0:
            transfers.append((banker, pid, net))
    return transfers


def fewest_transfers(nets: dict[str, int]) -> list[Transfer]:
    """Fewest-payments netting: repeatedly match the largest creditor with
    the largest debtor.

    Finding the true minimum number of transfers is NP-hard in general (it
    embeds set partition), so this is the standard greedy everyone ships —
    optimal or near-optimal at home-game sizes (n <= 20). Because it is a
    near-minimum, the UI must say "fewest payments" or "simplified", never
    "the minimum" — keep the claim true. Deterministic: ties break by
    player id ascending."""
    creditors = sorted(
        ((amt, pid) for pid, amt in nets.items() if amt > 0),
        key=lambda t: (-t[0], t[1]),
    )
    debtors = sorted(
        ((-amt, pid) for pid, amt in nets.items() if amt < 0),
        key=lambda t: (-t[0], t[1]),
    )
    creditors = [[amt, pid] for amt, pid in creditors]
    debtors = [[amt, pid] for amt, pid in debtors]
    transfers: list[Transfer] = []
    while creditors and debtors:
        credit, winner = creditors[0]
        debt, loser = debtors[0]
        amount = min(credit, debt)
        transfers.append((loser, winner, amount))
        creditors[0][0] -= amount
        debtors[0][0] -= amount
        if creditors[0][0] == 0:
            creditors.pop(0)
        else:
            creditors.sort(key=lambda t: (-t[0], t[1]))
        if debtors[0][0] == 0:
            debtors.pop(0)
        else:
            debtors.sort(key=lambda t: (-t[0], t[1]))
    return transfers


# ---------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------

class GroupCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class GroupJoinIn(BaseModel):
    invite_code: str = Field(min_length=1, max_length=20)


class MemberAddIn(BaseModel):
    user_id: str = Field(min_length=1)


class PlayerCreateIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=60)


class SessionCreateIn(BaseModel):
    session_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    player_ids: list[str] = Field(min_length=1, max_length=30)
    name: str | None = Field(default=None, max_length=80)
    stakes: str | None = Field(default=None, max_length=60)
    location: str | None = Field(default=None, max_length=80)


class SessionPlayerIn(BaseModel):
    player_id: str = Field(min_length=1)


class EntryIn(BaseModel):
    player_id: str = Field(min_length=1)
    kind: Literal["buyin", "rebuy", "addon", "cashout"]
    amount_cents: int = Field(ge=1, le=MAX_ENTRY_CENTS)


class SettleIn(BaseModel):
    mode: Literal["banker", "fewest_transfers"]
    banker_player_id: str | None = None


class PaidIn(BaseModel):
    paid: bool


# ---------------------------------------------------------------------
# Shared guards. Non-membership is always a 404, never a 403 — a group id
# must not be confirmable by guessing (docs/19 RLS rule, applied to the API
# surface too).
# ---------------------------------------------------------------------

def _membership_role(cur: Any, group_id: str, user_id: str) -> str | None:
    cur.execute(
        """
        select role from group_members
        where group_id = %s and user_id = %s and left_at is null
        """,
        (group_id, user_id),
    )
    row = cur.fetchone()
    return row[0] if row else None


def _require_member(cur: Any, group_id: str, user_id: str) -> str:
    role = _membership_role(cur, group_id, user_id)
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "group not found")
    return role


def _session_for_member(cur: Any, session_id: str, user_id: str) -> tuple:
    """(group_id, status, currency, role) or 404."""
    cur.execute(
        "select group_id, status, currency from game_sessions where id = %s",
        (session_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")
    group_id, session_status, currency = str(row[0]), row[1], row[2]
    role = _membership_role(cur, group_id, user_id)
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")
    return group_id, session_status, currency, role


def _add_roster_player_for_user(
    cur: Any, group_id: str, user_id: str
) -> None:
    """A claimed roster row for a user joining a group, if they lack one.
    Name collisions fall back to the unique username, then a suffixed code."""
    cur.execute(
        """
        select 1 from group_players
        where group_id = %s and claimed_by_user_id = %s
        """,
        (group_id, user_id),
    )
    if cur.fetchone():
        return
    cur.execute(
        "select username, display_name from profiles where id = %s", (user_id,)
    )
    username, display_name = cur.fetchone()
    candidates = [
        (display_name or username).strip()[:60],
        username[:60],
        f"{username[:53]}-{new_invite_code()[:4]}",
    ]
    for candidate in candidates:
        cur.execute(
            """
            select 1 from group_players
            where group_id = %s and lower(display_name) = lower(%s)
              and archived_at is null
            """,
            (group_id, candidate),
        )
        if cur.fetchone() is None:
            cur.execute(
                """
                insert into group_players
                    (group_id, display_name, claimed_by_user_id)
                values (%s, %s, %s)
                """,
                (group_id, candidate, user_id),
            )
            return


def _fetch_live_entries(cur: Any, session_id: str) -> list[Entry]:
    cur.execute(
        """
        select player_id::text, direction, amount_cents
        from session_entries
        where session_id = %s and voided_at is null
        order by occurred_at, id
        """,
        (session_id,),
    )
    return [(row[0], row[1], row[2]) for row in cur.fetchall()]


def _settlement_payload(
    nets: dict[str, int], balance: int, transfers: list[Transfer]
) -> dict[str, Any]:
    return {
        "balance_cents": balance,
        "nets": [
            {"player_id": pid, "net_cents": net}
            for pid, net in sorted(nets.items(), key=lambda t: (-t[1], t[0]))
        ],
        "transfers": [
            {"from_player_id": frm, "to_player_id": to, "amount_cents": amount}
            for frm, to, amount in transfers
        ],
    }


# ---------------------------------------------------------------------
# Groups, membership, roster
# ---------------------------------------------------------------------

@router.post("/api/games/groups", status_code=status.HTTP_201_CREATED)
def create_group(
    body: GroupCreateIn, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into poker_groups (name, owner_user_id, invite_code)
                    values (%s, %s, %s)
                    returning id, invite_code
                    """,
                    (body.name.strip(), user_id, new_invite_code()),
                )
                group_id, invite_code = cur.fetchone()
                cur.execute(
                    """
                    insert into group_members (group_id, user_id, role)
                    values (%s, %s, 'owner')
                    """,
                    (group_id, user_id),
                )
                _add_roster_player_for_user(cur, str(group_id), user_id)
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return {"id": str(group_id), "invite_code": invite_code}


@router.post("/api/games/groups/join")
def join_group(
    body: GroupJoinIn, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    code = body.invite_code.strip().upper()
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "select id from poker_groups where invite_code = %s", (code,)
                )
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(
                        status.HTTP_404_NOT_FOUND, "invite code not found"
                    )
                group_id = str(row[0])
                cur.execute(
                    """
                    insert into group_members (group_id, user_id)
                    values (%s, %s)
                    on conflict (group_id, user_id)
                    do update set left_at = null, joined_at = case
                        when group_members.left_at is null
                        then group_members.joined_at else now() end
                    """,
                    (group_id, user_id),
                )
                _add_roster_player_for_user(cur, group_id, user_id)
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return {"group_id": group_id, "status": "joined"}


@router.post(
    "/api/games/groups/{group_id}/members",
    status_code=status.HTTP_201_CREATED,
)
def add_member(
    group_id: str, body: MemberAddIn, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                role = _require_member(cur, group_id, user_id)
                if not can_manage(role):
                    raise HTTPException(
                        status.HTTP_403_FORBIDDEN, "owners and admins add members"
                    )
                cur.execute(
                    """
                    select 1 from friends
                    where user_id = %s and friend_user_id = %s
                    """,
                    (user_id, body.user_id),
                )
                if cur.fetchone() is None:
                    raise HTTPException(
                        status.HTTP_404_NOT_FOUND,
                        "you can only add your friends to a group",
                    )
                cur.execute(
                    """
                    insert into group_members (group_id, user_id)
                    values (%s, %s)
                    on conflict (group_id, user_id)
                    do update set left_at = null
                    """,
                    (group_id, body.user_id),
                )
                _add_roster_player_for_user(cur, group_id, body.user_id)
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return {"status": "added"}


@router.post("/api/games/groups/{group_id}/leave")
def leave_group(
    group_id: str, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                role = _require_member(cur, group_id, user_id)
                if role == "owner":
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        "the owner cannot leave their own group",
                    )
                cur.execute(
                    """
                    update group_members set left_at = now()
                    where group_id = %s and user_id = %s and left_at is null
                    """,
                    (group_id, user_id),
                )
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return {"status": "left"}


@router.post(
    "/api/games/groups/{group_id}/players",
    status_code=status.HTTP_201_CREATED,
)
def add_guest_player(
    group_id: str, body: PlayerCreateIn, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    name = title_case_name(body.display_name)
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "empty name")
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                _require_member(cur, group_id, user_id)
                cur.execute(
                    """
                    select 1 from group_players
                    where group_id = %s and lower(display_name) = lower(%s)
                      and archived_at is null
                    """,
                    (group_id, name),
                )
                if cur.fetchone():
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        f"{name} is already on the roster",
                    )
                cur.execute(
                    """
                    insert into group_players (group_id, display_name)
                    values (%s, %s)
                    returning id
                    """,
                    (group_id, name),
                )
                player_id = str(cur.fetchone()[0])
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return {"id": player_id, "display_name": name}


@router.post("/api/games/groups/{group_id}/players/{player_id}/claim")
def claim_player(
    group_id: str, player_id: str, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    """Link an unclaimed roster player to the caller. History (entries,
    settlements) hangs off the player id, so the claim inherits all of it
    with no data movement."""
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                _require_member(cur, group_id, user_id)
                cur.execute(
                    """
                    select 1 from group_players
                    where group_id = %s and claimed_by_user_id = %s
                    """,
                    (group_id, user_id),
                )
                if cur.fetchone():
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        "you already have a claimed player in this group",
                    )
                cur.execute(
                    """
                    update group_players set claimed_by_user_id = %s
                    where id = %s and group_id = %s
                      and claimed_by_user_id is null and archived_at is null
                    """,
                    (user_id, player_id, group_id),
                )
                if cur.rowcount == 0:
                    raise HTTPException(
                        status.HTTP_404_NOT_FOUND,
                        "player not found or already claimed",
                    )
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return {"status": "claimed"}


# ---------------------------------------------------------------------
# Sessions and the ledger
# ---------------------------------------------------------------------

@router.post(
    "/api/games/groups/{group_id}/sessions",
    status_code=status.HTTP_201_CREATED,
)
def create_session(
    group_id: str, body: SessionCreateIn, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                _require_member(cur, group_id, user_id)
                cur.execute(
                    "select currency from poker_groups where id = %s",
                    (group_id,),
                )
                currency = cur.fetchone()[0]
                cur.execute(
                    """
                    select count(*) from group_players
                    where group_id = %s and archived_at is null
                      and id = any(%s::uuid[])
                    """,
                    (group_id, body.player_ids),
                )
                if cur.fetchone()[0] != len(set(body.player_ids)):
                    raise HTTPException(
                        status.HTTP_422_UNPROCESSABLE_ENTITY,
                        "every player must be on this group's active roster",
                    )
                cur.execute(
                    """
                    insert into game_sessions
                        (group_id, session_date, name, stakes, location,
                         currency, created_by)
                    values (%s, %s, %s, %s, %s, %s, %s)
                    returning id
                    """,
                    (
                        group_id,
                        body.session_date,
                        body.name,
                        body.stakes,
                        body.location,
                        currency,
                        user_id,
                    ),
                )
                session_id = str(cur.fetchone()[0])
                for player_id in dict.fromkeys(body.player_ids):
                    cur.execute(
                        """
                        insert into session_players (session_id, player_id)
                        values (%s, %s)
                        """,
                        (session_id, player_id),
                    )
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return {"id": session_id}


@router.post(
    "/api/games/sessions/{session_id}/players",
    status_code=status.HTTP_201_CREATED,
)
def add_session_player(
    session_id: str, body: SessionPlayerIn, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                group_id, session_status, _, _ = _session_for_member(
                    cur, session_id, user_id
                )
                if session_status != "live":
                    raise HTTPException(
                        status.HTTP_409_CONFLICT, "session is not live"
                    )
                cur.execute(
                    """
                    select 1 from group_players
                    where id = %s and group_id = %s and archived_at is null
                    """,
                    (body.player_id, group_id),
                )
                if cur.fetchone() is None:
                    raise HTTPException(
                        status.HTTP_404_NOT_FOUND, "player not on the roster"
                    )
                cur.execute(
                    """
                    insert into session_players (session_id, player_id)
                    values (%s, %s)
                    on conflict (session_id, player_id) do nothing
                    """,
                    (session_id, body.player_id),
                )
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return {"status": "seated"}


@router.post(
    "/api/games/sessions/{session_id}/entries",
    status_code=status.HTTP_201_CREATED,
)
def add_entry(
    session_id: str, body: EntryIn, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    direction = direction_for_kind(body.kind)
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                _, session_status, _, _ = _session_for_member(
                    cur, session_id, user_id
                )
                if session_status != "live":
                    raise HTTPException(
                        status.HTTP_409_CONFLICT, "session is not live"
                    )
                cur.execute(
                    """
                    select 1 from session_players
                    where session_id = %s and player_id = %s
                    """,
                    (session_id, body.player_id),
                )
                if cur.fetchone() is None:
                    raise HTTPException(
                        status.HTTP_404_NOT_FOUND, "player is not in this session"
                    )
                cur.execute(
                    """
                    insert into session_entries
                        (session_id, player_id, direction, kind, amount_cents,
                         created_by)
                    values (%s, %s, %s, %s, %s, %s)
                    returning id, occurred_at
                    """,
                    (
                        session_id,
                        body.player_id,
                        direction,
                        body.kind,
                        body.amount_cents,
                        user_id,
                    ),
                )
                entry_id, occurred_at = cur.fetchone()
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return {
        "id": entry_id,
        "direction": direction,
        "occurred_at": occurred_at.isoformat(),
    }


@router.post("/api/games/entries/{entry_id}/void")
def void_entry(
    entry_id: int, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select session_id, created_by, voided_at
                    from session_entries where id = %s
                    """,
                    (entry_id,),
                )
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(
                        status.HTTP_404_NOT_FOUND, "entry not found"
                    )
                session_id, created_by, voided_at = str(row[0]), str(row[1]), row[2]
                _, session_status, _, role = _session_for_member(
                    cur, session_id, user_id
                )
                if session_status != "live":
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        "reopen the session to correct a settled ledger",
                    )
                if voided_at is not None:
                    raise HTTPException(
                        status.HTTP_409_CONFLICT, "entry is already voided"
                    )
                if not can_manage(role) and created_by != user_id:
                    raise HTTPException(
                        status.HTTP_403_FORBIDDEN,
                        "only the recorder or a group admin can void an entry",
                    )
                cur.execute(
                    """
                    update session_entries
                    set voided_at = now(), voided_by = %s
                    where id = %s
                    """,
                    (user_id, entry_id),
                )
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return {"status": "voided"}


# ---------------------------------------------------------------------
# Settlement
# ---------------------------------------------------------------------

def _proposed_transfers(
    cur: Any, session_id: str, mode: str, banker_player_id: str | None
) -> tuple[dict[str, int], int, list[Transfer]]:
    entries = _fetch_live_entries(cur, session_id)
    nets = player_nets(entries)
    balance = ledger_balance(entries)
    if mode == "banker":
        if banker_player_id is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "banker mode needs a banker",
            )
        cur.execute(
            """
            select 1 from session_players
            where session_id = %s and player_id = %s
            """,
            (session_id, banker_player_id),
        )
        if cur.fetchone() is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "the banker must be in the session",
            )
        transfers = banker_transfers(nets, banker_player_id)
    else:
        transfers = fewest_transfers(nets)
    return nets, balance, transfers


@router.get("/api/games/sessions/{session_id}/settle-preview")
def settle_preview(
    session_id: str,
    mode: Literal["banker", "fewest_transfers"] = Query(),
    banker_player_id: str | None = Query(default=None),
    user_id: str = Depends(current_user_id),
) -> dict[str, Any]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            _session_for_member(cur, session_id, user_id)
            nets, balance, transfers = _proposed_transfers(
                cur, session_id, mode, banker_player_id
            )
        conn.commit()
    return _settlement_payload(nets, balance, transfers)


@router.post("/api/games/sessions/{session_id}/settle")
def settle_session(
    session_id: str, body: SettleIn, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                _, session_status, _, _ = _session_for_member(
                    cur, session_id, user_id
                )
                if session_status != "live":
                    raise HTTPException(
                        status.HTTP_409_CONFLICT, "session is not live"
                    )
                entries = _fetch_live_entries(cur, session_id)
                balance = ledger_balance(entries)
                if balance != 0:
                    # The ledger refuses to lie: a table that does not
                    # balance is a counting error worth showing, never one
                    # to silently absorb (docs/19).
                    total_in = sum(a for _, d, a in entries if d == "in")
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        detail={
                            "error": "unbalanced",
                            "balance_cents": balance,
                            "total_in_cents": total_in,
                            "total_out_cents": total_in - balance,
                        },
                    )
                nets, _, transfers = _proposed_transfers(
                    cur, session_id, body.mode, body.banker_player_id
                )
                for frm, to, amount in transfers:
                    cur.execute(
                        """
                        insert into session_settlements
                            (session_id, from_player_id, to_player_id,
                             amount_cents, mode)
                        values (%s, %s, %s, %s, %s)
                        """,
                        (session_id, frm, to, amount, body.mode),
                    )
                cur.execute(
                    """
                    update game_sessions
                    set status = 'settled', settled_at = now(),
                        ended_at = coalesce(ended_at, now()),
                        settlement_mode = %s, banker_player_id = %s
                    where id = %s
                    """,
                    (body.mode, body.banker_player_id, session_id),
                )
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return _settlement_payload(nets, 0, transfers)


@router.post("/api/games/settlements/{settlement_id}/paid")
def mark_settlement_paid(
    settlement_id: int, body: PaidIn, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "select session_id from session_settlements where id = %s",
                    (settlement_id,),
                )
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(
                        status.HTTP_404_NOT_FOUND, "settlement not found"
                    )
                _session_for_member(cur, str(row[0]), user_id)
                cur.execute(
                    """
                    update session_settlements
                    set paid_at = case when %s then now() else null end
                    where id = %s
                    """,
                    (body.paid, settlement_id),
                )
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return {"status": "paid" if body.paid else "unpaid"}


@router.post("/api/games/sessions/{session_id}/reopen")
def reopen_session(
    session_id: str, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    """The 'correct it days later' path: reopen, void/add entries, settle
    again. Settled sessions are otherwise immutable, so the audit trail of
    what was corrected survives."""
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                _, session_status, _, role = _session_for_member(
                    cur, session_id, user_id
                )
                if not can_manage(role):
                    raise HTTPException(
                        status.HTTP_403_FORBIDDEN,
                        "owners and admins reopen sessions",
                    )
                if session_status != "settled":
                    raise HTTPException(
                        status.HTTP_409_CONFLICT, "only settled sessions reopen"
                    )
                cur.execute(
                    "delete from session_settlements where session_id = %s",
                    (session_id,),
                )
                cur.execute(
                    """
                    update game_sessions
                    set status = 'live', settled_at = null,
                        settlement_mode = null, ended_at = null
                    where id = %s
                    """,
                    (session_id,),
                )
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return {"status": "live"}
