#!/usr/bin/env python3
"""Exercise the M8 API against a disposable, fully migrated Postgres 16.

This is intentionally separate from pytest because it requires Docker:

    .venv/bin/python api/verify_play_lifecycle.py

The container is removed even when an assertion fails.  The lifecycle covers
real route SQL, idempotent retries, authoritative attempts/XP, terminal replay
snapshots, recent reads, and a complete hand review.
"""
from __future__ import annotations

from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
from uuid import UUID

import psycopg
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import api.play as play_api  # noqa: E402

CONTAINER = f"potluck-m8-api-lifecycle-{os.getpid()}"
IMAGE = os.environ.get("POTLUCK_POSTGRES_IMAGE", "postgres:16-alpine")
USER_ID = "11111111-1111-4111-8111-111111111111"

BOOTSTRAP = r"""
create extension if not exists pgcrypto;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create publication supabase_realtime;
"""

SEED_USER = f"""
insert into auth.users (id, email, raw_user_meta_data) values
  ('{USER_ID}', 'm8-api-lifecycle@example.test',
   '{{"username":"m8_api_lifecycle"}}'::jsonb);
"""


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _run(*args: str, input_text: str | None = None, quiet: bool = False) -> None:
    subprocess.run(
        args,
        input=input_text,
        text=True,
        check=True,
        stdout=subprocess.DEVNULL if quiet else None,
    )


def _psql_file(path: str) -> None:
    _run(
        "docker",
        "exec",
        "-i",
        CONTAINER,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-f",
        f"/workspace/{path}",
        quiet=True,
    )


def _expect_conflict(call) -> None:
    try:
        call()
    except HTTPException as exc:
        assert exc.status_code == 409, exc
    else:
        raise AssertionError("expected API conflict")


def _exercise(database_url: str) -> None:
    @contextmanager
    def connection():
        conn = psycopg.connect(database_url)
        conn.autocommit = False
        try:
            yield conn
        finally:
            conn.close()

    play_api.get_connection = connection

    session_client_id = UUID("aaaaaaaa-1111-4111-8111-111111111111")
    hand_client_id = UUID("bbbbbbbb-1111-4111-8111-111111111111")
    decision_client_ids = [
        UUID(f"cccccccc-1111-4111-8111-{index:012d}") for index in range(1, 4)
    ]

    session_body = play_api.PlaySessionCreateIn(client_session_id=session_client_id)
    session = play_api.create_play_session(session_body, USER_ID)
    session_retry = play_api.create_play_session(session_body, USER_ID)
    assert session_retry["id"] == session["id"]
    assert session_retry["status"] == "incomplete"

    session_id = UUID(session["id"])
    hand_body = play_api.PlayHandCreateIn(
        client_hand_id=hand_client_id,
        flop="As5h4h",
        instance_index=0,
    )
    hand = play_api.create_play_hand(session_id, hand_body, USER_ID)
    hand_retry = play_api.create_play_hand(session_id, hand_body, USER_ID)
    assert hand_retry["id"] == hand["id"]
    assert hand_retry["initial_board_cards"] == ["As", "5h", "4h"]
    _expect_conflict(
        lambda: play_api.create_play_hand(
            session_id,
            play_api.PlayHandCreateIn(
                client_hand_id=hand_client_id,
                flop="As5h4h",
                instance_index=1,
            ),
            USER_ID,
        )
    )
    hand_id = UUID(hand["id"])

    # Completion is rejected until the saved branch is terminal.
    first_body = play_api.PlayDecisionCreateIn(
        client_decision_id=decision_client_ids[0],
        node_path="preflop",
        chosen_action_code="c",
    )
    # Regression for the global profile -> session -> hand lock order.  A
    # retry of this same session and the first decision contend on all three
    # rows; the historical reverse order deadlocked this exact pair.
    start_together = threading.Barrier(2)

    def retry_session_concurrently():
        start_together.wait()
        return play_api.create_play_session(session_body, USER_ID)

    def create_first_decision_concurrently():
        start_together.wait()
        return play_api.create_play_decision(hand_id, first_body, USER_ID)

    with ThreadPoolExecutor(max_workers=2) as executor:
        session_future = executor.submit(retry_session_concurrently)
        decision_future = executor.submit(create_first_decision_concurrently)
        assert session_future.result(timeout=10)["id"] == session["id"]
        first = decision_future.result(timeout=10)
    first_retry = play_api.create_play_decision(hand_id, first_body, USER_ID)
    assert first_retry["id"] == first["id"]
    assert first_retry["xp_earned"] == 0
    _expect_conflict(
        lambda: play_api.update_play_hand_status(
            hand_id, play_api.PlayStatusUpdateIn(status="completed"), USER_ID
        )
    )

    # Bet, then fold to the scripted raise: root action index 1, child action
    # index 0, terminal path 1.0.  Only preflop and the fold earn XP.
    remaining = [("root", "B18"), ("1", "F")]
    for client_id, (node_path, action) in zip(decision_client_ids[1:], remaining):
        body = play_api.PlayDecisionCreateIn(
            client_decision_id=client_id,
            node_path=node_path,
            chosen_action_code=action,
        )
        saved = play_api.create_play_decision(hand_id, body, USER_ID)
        retry = play_api.create_play_decision(hand_id, body, USER_ID)
        assert retry["id"] == saved["id"]
        assert retry["xp_earned"] == 0

    _expect_conflict(
        lambda: play_api.create_play_decision(
            hand_id,
            play_api.PlayDecisionCreateIn(
                client_decision_id=decision_client_ids[-1],
                node_path="1",
                chosen_action_code="C",
            ),
            USER_ID,
        )
    )

    completed = play_api.update_play_hand_status(
        hand_id, play_api.PlayStatusUpdateIn(status="completed"), USER_ID
    )
    assert completed["status"] == "completed"
    assert completed["result_snapshot"]["terminal_path"] == "1.0"
    assert isinstance(completed["runout_cards"], list)
    assert len(completed["action_history_snapshot"]) >= 3

    review = play_api.play_hand_review(hand_id, USER_ID)
    assert review["status"] == "completed"
    assert len(review["decisions"]) == 3
    assert all(decision["actions"] for decision in review["decisions"])
    assert review["decisions"][0]["grading_source"] == "reference"
    assert review["decisions"][1]["ev_basis"] == "relative_to_best"

    hands = play_api.recent_play_hands(session_id, 50, USER_ID)
    assert len(hands["hands"]) == 1
    assert hands["hands"][0]["decision_count"] == 3
    closed_session = play_api.update_play_session_status(
        session_id, play_api.PlayStatusUpdateIn(status="completed"), USER_ID
    )
    assert closed_session["status"] == "completed"
    # A response lost just before session closure remains safely retryable.
    closed_hand_retry = play_api.create_play_hand(session_id, hand_body, USER_ID)
    assert closed_hand_retry["id"] == hand["id"]
    sessions = play_api.recent_play_sessions(20, USER_ID)
    summary = next(row for row in sessions["sessions"] if row["id"] == str(session_id))
    assert summary["hand_count"] == 1
    assert summary["decision_count"] == 3

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select count(*), count(distinct attempt_id) "
                "from play_decisions where hand_id = %s",
                (hand_id,),
            )
            assert cur.fetchone() == (3, 3)
            cur.execute(
                "select count(*) from attempts "
                "where user_id = %s and drill_kind = 'play'",
                (USER_ID,),
            )
            assert cur.fetchone()[0] == 3
            cur.execute("select xp from profiles where id = %s", (USER_ID,))
            assert cur.fetchone()[0] == 20

    # Session abandonment locks session -> child hands.  Race it against a
    # decision (profile -> session -> hand) and require both transactions to
    # settle without PostgreSQL's deadlock detector aborting either one.
    race_session = play_api.create_play_session(
        play_api.PlaySessionCreateIn(
            client_session_id=UUID("dddddddd-1111-4111-8111-111111111111")
        ),
        USER_ID,
    )
    race_session_id = UUID(race_session["id"])
    race_hand = play_api.create_play_hand(
        race_session_id,
        play_api.PlayHandCreateIn(
            client_hand_id=UUID("eeeeeeee-1111-4111-8111-111111111111"),
            flop="As5h4h",
            instance_index=0,
        ),
        USER_ID,
    )
    race_hand_id = UUID(race_hand["id"])
    race_decision = play_api.PlayDecisionCreateIn(
        client_decision_id=UUID("ffffffff-1111-4111-8111-111111111111"),
        node_path="preflop",
        chosen_action_code="c",
    )
    abandon_together = threading.Barrier(2)

    def submit_while_abandoning() -> str:
        abandon_together.wait()
        try:
            play_api.create_play_decision(race_hand_id, race_decision, USER_ID)
            return "saved"
        except HTTPException as exc:
            assert exc.status_code == 409
            return "closed_first"

    def abandon_while_submitting():
        abandon_together.wait()
        return play_api.update_play_session_status(
            race_session_id,
            play_api.PlayStatusUpdateIn(status="abandoned"),
            USER_ID,
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        decision_future = executor.submit(submit_while_abandoning)
        abandon_future = executor.submit(abandon_while_submitting)
        decision_outcome = decision_future.result(timeout=10)
        abandoned = abandon_future.result(timeout=10)
    assert decision_outcome in {"saved", "closed_first"}
    assert abandoned["status"] == "abandoned"
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select s.status, h.status, count(d.id) "
                "from play_sessions s join play_hands h on h.session_id = s.id "
                "left join play_decisions d on d.hand_id = h.id "
                "where s.id = %s group by s.status, h.status",
                (race_session_id,),
            )
            session_status, hand_status, decision_count = cur.fetchone()
            assert (session_status, hand_status) == ("abandoned", "abandoned")
            assert decision_count == (1 if decision_outcome == "saved" else 0)


def main() -> int:
    port = _free_port()
    database_url = f"postgresql://postgres:m8-api-test@127.0.0.1:{port}/postgres"
    _run(
        "docker",
        "run",
        "--rm",
        "-d",
        "--name",
        CONTAINER,
        "-p",
        f"127.0.0.1:{port}:5432",
        "-e",
        "POSTGRES_PASSWORD=m8-api-test",
        "-v",
        f"{ROOT}:/workspace:ro",
        IMAGE,
        quiet=True,
    )
    try:
        time.sleep(0.5)
        consecutive_ready = 0
        for _ in range(100):
            ready = subprocess.run(
                ["docker", "exec", CONTAINER, "pg_isready", "-U", "postgres"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if ready.returncode == 0:
                consecutive_ready += 1
                if consecutive_ready == 3:
                    break
            else:
                consecutive_ready = 0
            time.sleep(0.1)
        else:
            raise RuntimeError("Postgres did not become ready")

        _run(
            "docker",
            "exec",
            "-i",
            CONTAINER,
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "postgres",
            input_text=BOOTSTRAP,
            quiet=True,
        )
        for migration in (
            "supabase/migrations/0001_initial_schema.sql",
            "supabase/migrations/0002_lesson_screen_attempts.sql",
            "supabase/migrations/0003_social_policies.sql",
        ):
            _psql_file(migration)
        _run(
            "docker",
            "exec",
            "-i",
            CONTAINER,
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "postgres",
            input_text=SEED_USER,
            quiet=True,
        )
        _psql_file("supabase/migrations/0004_m8_play_history.sql")
        _exercise(database_url)
        print(
            "M8 API lifecycle passed: idempotent session/hand/decisions, "
            "3 linked attempts, 20 XP, terminal snapshot, recent reads, review, "
            "concurrent retry/abandon races"
        )
        return 0
    finally:
        subprocess.run(
            ["docker", "stop", CONTAINER],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"M8 API lifecycle regression failed: {exc}", file=sys.stderr)
        raise SystemExit(exc.returncode) from exc
