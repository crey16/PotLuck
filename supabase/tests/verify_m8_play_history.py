#!/usr/bin/env python3
"""Run the M8 migration and RLS regression checks in disposable Postgres 16.

Usage from the repository root:

    python3 supabase/tests/verify_m8_play_history.py

Docker must be running. The container is removed even when an assertion fails.
"""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[2]
CONTAINER = f"potluck-m8-schema-test-{os.getpid()}"
IMAGE = os.environ.get("POTLUCK_POSTGRES_IMAGE", "postgres:16-alpine")
PSQL = [
    "docker", "exec", "-i", CONTAINER,
    "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres",
]

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


def run(*args: str, input_text: str | None = None) -> None:
    subprocess.run(args, input=input_text, text=True, check=True)


def psql_file(path: str) -> None:
    run(*PSQL, "-f", f"/workspace/{path}")


def main() -> int:
    run(
        "docker", "run", "--rm", "-d", "--name", CONTAINER,
        "-e", "POSTGRES_PASSWORD=m8-schema-test",
        "-v", f"{ROOT}:/workspace:ro", IMAGE,
    )
    try:
        # The official image briefly starts an initialization server before
        # replacing it with the final server. Do not mistake that first socket
        # for readiness and race its shutdown.
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

        run(*PSQL, input_text=BOOTSTRAP)
        for migration in (
            "supabase/migrations/0001_initial_schema.sql",
            "supabase/migrations/0002_lesson_screen_attempts.sql",
            "supabase/migrations/0003_social_policies.sql",
        ):
            psql_file(migration)
        psql_file("supabase/tests/0004_m8_play_history_fixture.sql")
        psql_file("supabase/migrations/0004_m8_play_history.sql")
        psql_file("supabase/tests/0004_m8_play_history_test.sql")
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
        print(f"M8 database regression failed: {exc}", file=sys.stderr)
        raise SystemExit(exc.returncode) from exc
