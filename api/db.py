"""psycopg connection handling for the Supabase pooler connection.

`DATABASE_URL` must be the pooler string (port 6543) — see
docs/01-architecture.md. The pool is opened lazily on first use so importing
this module (or the FastAPI app) never requires DATABASE_URL to be set,
which matters for cold starts and for unit-testing routes that don't touch
the DB.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

import psycopg
from psycopg_pool import ConnectionPool

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise RuntimeError("DATABASE_URL is not set")
        # Serverless: keep the pool tiny. min_size=0 means no connection is
        # opened until first use (nothing to do on a cold start that never
        # touches the DB).
        _pool = ConnectionPool(
            conninfo=database_url,
            min_size=0,
            max_size=2,
            open=True,
            # DATABASE_URL is the TRANSACTION pooler (port 6543), where server
            # connections are shared between clients. psycopg auto-prepares a
            # statement after 5 executions and names them _pg3_0, _pg3_1, …;
            # a later request landing on a backend that already holds that name
            # dies with DuplicatePreparedStatement. Disabling auto-preparation
            # is the supported fix for PgBouncer transaction mode.
            kwargs={"prepare_threshold": None},
        )
    return _pool


@contextmanager
def get_connection() -> Iterator[psycopg.Connection]:
    """Yield a pooled connection with autocommit off. Callers own the
    transaction — commit/rollback explicitly per request."""
    pool = get_pool()
    with pool.connection() as conn:
        conn.autocommit = False
        yield conn
