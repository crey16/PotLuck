"""Friends: username search, request lifecycle, roster, unfriend.

All mutations run in one transaction on the pooled service connection; the
two `friends` rows of a friendship are only ever written together here
(there is deliberately no INSERT policy on `friends` — RLS stays closed).
Search never touches email, and a private profile is invisible unless the
searcher is already a friend.
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from api.db import get_connection
from api.deps import current_user_id

router = APIRouter()

REQUEST_STATUSES = ("pending", "accepted", "declined")
RELATIONSHIPS = ("none", "friends", "pending_outgoing", "pending_incoming")


class FriendRequestIn(BaseModel):
    to_user_id: str = Field(min_length=1)


class FriendRespondIn(BaseModel):
    request_id: int = Field(ge=1)
    action: Literal["accept", "decline"]


def relationship_of(is_friend: bool, pending_out: bool, pending_in: bool) -> str:
    """Precedence: friends > pending_outgoing > pending_incoming > none."""
    if is_friend:
        return "friends"
    if pending_out:
        return "pending_outgoing"
    if pending_in:
        return "pending_incoming"
    return "none"


def escape_like_prefix(q: str) -> str:
    """Lowercased prefix pattern with LIKE wildcards escaped (escape '\\')."""
    escaped = (
        q.lower().replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")
    )
    return f"{escaped}%"


def decide_friend_request(
    *,
    is_self: bool,
    target_exists: bool,
    already_friends: bool,
    pending_outgoing: bool,
    pending_reverse: bool,
) -> str:
    """The guard cascade, in order. Returns what the endpoint should do."""
    if is_self:
        return "reject_self"
    if not target_exists:
        return "not_found"
    if already_friends:
        return "conflict_friends"
    if pending_outgoing:
        return "conflict_pending"
    if pending_reverse:
        return "auto_accept"
    return "create"


def _create_friendship(cur: Any, user_a: str, user_b: str) -> None:
    """Both rows of the bidirectional friendship, idempotently."""
    cur.execute(
        """
        insert into friends (user_id, friend_user_id)
        values (%s, %s), (%s, %s)
        on conflict (user_id, friend_user_id) do nothing
        """,
        (user_a, user_b, user_b, user_a),
    )


def _profile_row(row: Any) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "username": row[1],
        "display_name": row[2],
        "level": row[3],
        "streak_count": row[4],
    }


@router.get("/api/users/search")
def search_users(
    q: str = Query(min_length=1, max_length=100),
    user_id: str = Depends(current_user_id),
) -> list[dict[str, Any]]:
    prefix = escape_like_prefix(q.strip())
    if prefix == "%":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "search query is empty"
        )
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                r"""
                select p.id, p.username, p.display_name, p.level, p.streak_count,
                       (f.user_id is not null) as is_friend,
                       (fr_out.id is not null) as pending_outgoing,
                       (fr_in.id is not null) as pending_incoming
                from profiles p
                left join friends f
                  on f.user_id = %(me)s and f.friend_user_id = p.id
                left join friend_requests fr_out
                  on fr_out.from_user_id = %(me)s and fr_out.to_user_id = p.id
                 and fr_out.status = 'pending'
                left join friend_requests fr_in
                  on fr_in.from_user_id = p.id and fr_in.to_user_id = %(me)s
                 and fr_in.status = 'pending'
                where lower(p.username) like %(prefix)s escape '\'
                  and p.id <> %(me)s
                  and (p.is_public or f.user_id is not null)
                order by lower(p.username)
                limit 10
                """,
                {"me": user_id, "prefix": prefix},
            )
            rows = cur.fetchall()
        conn.commit()
    return [
        {
            **_profile_row(row),
            "relationship": relationship_of(row[5], row[6], row[7]),
        }
        for row in rows
    ]


@router.post("/api/friends/request", status_code=status.HTTP_201_CREATED)
def send_friend_request(
    body: FriendRequestIn, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select
                      exists(select 1 from profiles where id = %(to)s),
                      exists(select 1 from friends
                             where user_id = %(me)s and friend_user_id = %(to)s),
                      exists(select 1 from friend_requests
                             where from_user_id = %(me)s and to_user_id = %(to)s
                               and status = 'pending'),
                      (select id from friend_requests
                       where from_user_id = %(to)s and to_user_id = %(me)s
                         and status = 'pending')
                    """,
                    {"me": user_id, "to": body.to_user_id},
                )
                target_exists, already_friends, pending_out, reverse_id = (
                    cur.fetchone()
                )
                decision = decide_friend_request(
                    is_self=body.to_user_id == user_id,
                    target_exists=target_exists,
                    already_friends=already_friends,
                    pending_outgoing=pending_out,
                    pending_reverse=reverse_id is not None,
                )
                if decision == "reject_self":
                    raise HTTPException(
                        status.HTTP_400_BAD_REQUEST,
                        "you cannot friend yourself",
                    )
                if decision == "not_found":
                    raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
                if decision == "conflict_friends":
                    raise HTTPException(
                        status.HTTP_409_CONFLICT, "already friends"
                    )
                if decision == "conflict_pending":
                    raise HTTPException(
                        status.HTTP_409_CONFLICT, "request already pending"
                    )
                if decision == "auto_accept":
                    cur.execute(
                        """
                        update friend_requests
                        set status = 'accepted', updated_at = now()
                        where id = %s
                        """,
                        (reverse_id,),
                    )
                    _create_friendship(cur, user_id, body.to_user_id)
                    result: dict[str, Any] = {"status": "accepted"}
                else:
                    cur.execute(
                        """
                        insert into friend_requests (from_user_id, to_user_id)
                        values (%s, %s)
                        returning id
                        """,
                        (user_id, body.to_user_id),
                    )
                    result = {"status": "pending", "request_id": cur.fetchone()[0]}
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return result


@router.get("/api/friends/requests")
def list_friend_requests(
    user_id: str = Depends(current_user_id),
) -> dict[str, list[dict[str, Any]]]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select fr.id, fr.from_user_id, fr.to_user_id, fr.created_at,
                       p.id, p.username, p.display_name, p.level, p.streak_count
                from friend_requests fr
                join profiles p
                  on p.id = case
                       when fr.to_user_id = %(me)s then fr.from_user_id
                       else fr.to_user_id
                     end
                where fr.status = 'pending'
                  and (fr.from_user_id = %(me)s or fr.to_user_id = %(me)s)
                order by fr.created_at desc
                """,
                {"me": user_id},
            )
            rows = cur.fetchall()
        conn.commit()
    incoming, outgoing = [], []
    for row in rows:
        entry = {
            "id": row[0],
            "from_user_id": str(row[1]),
            "to_user_id": str(row[2]),
            "created_at": row[3],
            "user": _profile_row(row[4:9]),
        }
        (incoming if str(row[2]) == user_id else outgoing).append(entry)
    return {"incoming": incoming, "outgoing": outgoing}


@router.post("/api/friends/respond")
def respond_to_request(
    body: FriendRespondIn, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    new_status = "accepted" if body.action == "accept" else "declined"
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    update friend_requests
                    set status = %s, updated_at = now()
                    where id = %s and to_user_id = %s and status = 'pending'
                    returning from_user_id
                    """,
                    (new_status, body.request_id, user_id),
                )
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(
                        status.HTTP_404_NOT_FOUND, "request not found"
                    )
                if body.action == "accept":
                    _create_friendship(cur, user_id, str(row[0]))
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return {"status": new_status}


@router.delete("/api/friends/requests/{request_id}")
def cancel_request(
    request_id: int, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    delete from friend_requests
                    where id = %s and from_user_id = %s and status = 'pending'
                    """,
                    (request_id, user_id),
                )
                if cur.rowcount == 0:
                    raise HTTPException(
                        status.HTTP_404_NOT_FOUND, "request not found"
                    )
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return {"status": "cancelled"}


@router.get("/api/friends")
def list_friends(user_id: str = Depends(current_user_id)) -> list[dict[str, Any]]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select p.id, p.username, p.display_name, p.level,
                       p.streak_count, p.xp
                from friends f
                join profiles p on p.id = f.friend_user_id
                where f.user_id = %s
                order by lower(p.username)
                """,
                (user_id,),
            )
            rows = cur.fetchall()
        conn.commit()
    return [{**_profile_row(row), "xp": row[5]} for row in rows]


@router.delete("/api/friends/{friend_user_id}")
def unfriend(
    friend_user_id: str, user_id: str = Depends(current_user_id)
) -> dict[str, Any]:
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    delete from friends
                    where (user_id = %(me)s and friend_user_id = %(other)s)
                       or (user_id = %(other)s and friend_user_id = %(me)s)
                    """,
                    {"me": user_id, "other": friend_user_id},
                )
                if cur.rowcount == 0:
                    raise HTTPException(
                        status.HTTP_404_NOT_FOUND, "not friends"
                    )
                # Remove the accepted request rows too, so the pair can
                # re-friend later without hitting unique(from,to).
                cur.execute(
                    """
                    delete from friend_requests
                    where status = 'accepted'
                      and ((from_user_id = %(me)s and to_user_id = %(other)s)
                        or (from_user_id = %(other)s and to_user_id = %(me)s))
                    """,
                    {"me": user_id, "other": friend_user_id},
                )
        except Exception:
            conn.rollback()
            raise
        conn.commit()
    return {"status": "removed"}
