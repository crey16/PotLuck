"""Guards the FastAPI half of M8.8A's tracing.

Two things are being protected. First, the **join**: a request id the browser
sent has to survive this layer unchanged, because the browser is the only place
that knows a page load and its API calls are one action. Second, the **log
line**: it is unauthenticated input's first stop, and it must not be possible
to write a newline, a user id or an unbounded key into it.
"""
from __future__ import annotations

import json
import pathlib
import re

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import observability


REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent


def _app(monkeypatch=None) -> tuple[FastAPI, list[str]]:
    """A tiny app with the middleware installed and its log captured."""
    app = FastAPI()
    observability.install(app)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/play/hands/{hand_id}")
    def hand(hand_id: str) -> dict:
        return {"id": hand_id}

    @app.get("/api/boom")
    def boom() -> dict:
        raise RuntimeError("nope")

    return app, []


def _capture(monkeypatch) -> list[dict]:
    """Redirect `emit` into a list, and force logging on."""
    lines: list[dict] = []
    monkeypatch.setattr(observability, "perf_logging_enabled", lambda: True)
    real_format = observability.format_event

    def fake_emit(event: dict) -> None:
        # Serialize for real, then parse — so the test sees exactly what a log
        # reader would see, not the in-memory dict.
        lines.append(json.loads(real_format(event)))

    monkeypatch.setattr(observability, "emit", fake_emit)
    return lines


def _reset_cold_state() -> None:
    observability._served = 0


# --------------------------------------------------------------- validation


def test_valid_ids_are_accepted():
    for value in ["9f3c1a04b7e25d68-0", "abcdefgh", "A" * 64, "a-b_c-d_e"]:
        assert observability.is_valid_request_id(value), value


def test_hostile_ids_are_rejected():
    for value in [
        None,
        "",
        "short",
        "x" * 65,
        "abcdefgh\nevt=fake",   # log-line injection
        'abcd"efgh',            # would break the JSON a reader parses
        "abcdefgh evt=x",
        "../../etc/passwd",
        "abcdefgh\x00",
    ]:
        assert not observability.is_valid_request_id(value), repr(value)
        resolved, generated = observability.resolve_request_id(value)
        assert generated is True
        assert resolved != value
        assert observability.is_valid_request_id(resolved)


def test_generated_ids_are_unique_and_well_formed():
    ids = {observability.new_request_id() for _ in range(500)}
    assert len(ids) == 500
    for value in ids:
        assert re.fullmatch(r"[0-9a-f]{16}-0", value)


def test_trace_of_strips_only_a_real_hop():
    assert observability.trace_of("9f3c1a04b7e25d68-2") == "9f3c1a04b7e25d68"
    assert observability.trace_of("9f3c1a04b7e25d68-9999") == "9f3c1a04b7e25d68"
    # Five digits is not a hop this project mints.
    assert observability.trace_of("9f3c1a04b7e25d68-10000") == "9f3c1a04b7e25d68-10000"
    assert observability.trace_of("some-external-id") == "some-external-id"
    assert observability.trace_of("abcdefghijklmnop") == "abcdefghijklmnop"


# ------------------------------------------------------------- propagation


def test_incoming_request_id_is_preserved_end_to_end(monkeypatch):
    _reset_cold_state()
    lines = _capture(monkeypatch)
    app, _ = _app()
    with TestClient(app) as client:
        response = client.get(
            "/api/health", headers={"x-request-id": "9f3c1a04b7e25d68-2"}
        )

    # Echoed on the response...
    assert response.headers["x-request-id"] == "9f3c1a04b7e25d68-2"
    # ...and identical in the log, under the trace the document used.
    assert lines[0]["rid"] == "9f3c1a04b7e25d68-2"
    assert lines[0]["trace"] == "9f3c1a04b7e25d68"
    # An adopted id is NOT marked as generated — that flag is how a reader
    # tells "the client did not send one" from "propagation broke".
    assert "origin" not in lines[0]


def test_an_absent_request_id_is_generated_and_flagged(monkeypatch):
    _reset_cold_state()
    lines = _capture(monkeypatch)
    app, _ = _app()
    with TestClient(app) as client:
        response = client.get("/api/health")

    generated = response.headers["x-request-id"]
    assert observability.is_valid_request_id(generated)
    assert lines[0]["rid"] == generated
    assert lines[0]["origin"] == "generated"


def test_a_malformed_incoming_id_is_replaced_not_echoed(monkeypatch):
    _reset_cold_state()
    lines = _capture(monkeypatch)
    app, _ = _app()
    with TestClient(app) as client:
        response = client.get("/api/health", headers={"x-request-id": "../evil"})

    assert response.headers["x-request-id"] != "../evil"
    assert lines[0]["rid"] != "../evil"
    assert observability.is_valid_request_id(lines[0]["rid"])


def test_the_route_key_is_the_template_never_the_raw_path(monkeypatch):
    _reset_cold_state()
    lines = _capture(monkeypatch)
    app, _ = _app()
    with TestClient(app) as client:
        client.get("/api/play/hands/9f2c-4d1a-secret?token=abc")

    # The hand id and the query string are both absent: one is a per-request
    # value that would make every row n=1, the other is user-supplied.
    assert lines[0]["route"] == "/api/play/hands/{hand_id}"
    assert "9f2c" not in json.dumps(lines[0])
    assert "token" not in json.dumps(lines[0])


def test_an_unmatched_path_collapses_to_one_key(monkeypatch):
    _reset_cold_state()
    lines = _capture(monkeypatch)
    app, _ = _app()
    with TestClient(app) as client:
        for i in range(50):
            client.get(f"/api/invented/{i}")

    # A 404 flood must add one row, not fifty.
    assert {line["route"] for line in lines} == {"unmatched"}


# ------------------------------------------------------------- cold / warm


def test_the_first_request_of_a_process_is_cold_and_reports_boot(monkeypatch):
    _reset_cold_state()
    lines = _capture(monkeypatch)
    app, _ = _app()
    with TestClient(app) as client:
        client.get("/api/health")
        client.get("/api/health")

    assert lines[0]["cold"] is True
    assert "boot_ms" in lines[0], "a cold line must say how much of it was boot"
    assert lines[1]["cold"] is False
    # Only the cold line carries boot: adding it to a warm one would double
    # count a cost that request never paid.
    assert "boot_ms" not in lines[1]


# ------------------------------------------------------------------ status


def test_the_status_is_recorded_including_failures(monkeypatch):
    _reset_cold_state()
    lines = _capture(monkeypatch)
    app, _ = _app()
    with TestClient(app, raise_server_exceptions=False) as client:
        client.get("/api/health")
        client.get("/api/boom")

    assert lines[0]["status"] == 200
    assert lines[1]["status"] == 500
    # The exception type, not its message: a message can contain anything the
    # code interpolated into it, including a row someone else owns.
    assert lines[1]["error"] == "RuntimeError"


def test_an_exception_is_re_raised_unchanged(monkeypatch):
    _reset_cold_state()
    _capture(monkeypatch)
    app, _ = _app()
    client = TestClient(app, raise_server_exceptions=True)
    try:
        client.get("/api/boom")
    except RuntimeError as exc:
        assert str(exc) == "nope"
    else:  # pragma: no cover
        raise AssertionError("the middleware swallowed the error")


# ------------------------------------------------------------- log hygiene


def test_a_log_line_never_carries_identity_or_a_payload(monkeypatch):
    _reset_cold_state()
    lines = _capture(monkeypatch)
    app, _ = _app()
    with TestClient(app) as client:
        client.get(
            "/api/health",
            headers={
                "authorization": "Bearer eyJhbGciOi.SUPERSECRET.token",
                "cookie": "sb-access-token=SUPERSECRET",
            },
        )

    blob = json.dumps(lines[0])
    assert "SUPERSECRET" not in blob
    assert "Bearer" not in blob
    assert "cookie" not in blob.lower()
    # A closed set of keys, checked by name so a new one is a deliberate edit.
    assert set(lines[0]) <= {
        "evt", "rid", "trace", "route", "method", "ms", "status", "cold",
        "boot_ms", "origin", "error",
    }


def test_format_event_produces_one_parseable_line():
    line = observability.format_event(
        {"evt": "api.request", "rid": "a" * 8, "ms": 1.25, "skipped": None}
    )
    assert "\n" not in line
    parsed = json.loads(line)
    # `None` fields are dropped rather than written as JSON null, which any
    # summarizer would read as a zero.
    assert "skipped" not in parsed
    assert parsed["ms"] == 1.25


def test_logging_is_opt_in_outside_development(monkeypatch):
    monkeypatch.delenv("PERF_LOG", raising=False)
    monkeypatch.delenv("VERCEL_ENV", raising=False)
    assert observability.perf_logging_enabled() is True
    monkeypatch.setenv("VERCEL_ENV", "production")
    assert observability.perf_logging_enabled() is False
    monkeypatch.setenv("PERF_LOG", "1")
    assert observability.perf_logging_enabled() is True
    monkeypatch.setenv("PERF_LOG", "0")
    assert observability.perf_logging_enabled() is False


def test_nothing_is_emitted_when_logging_is_off(monkeypatch, capsys):
    monkeypatch.setattr(observability, "perf_logging_enabled", lambda: False)
    observability.emit({"evt": "api.request"})
    assert capsys.readouterr().out == ""


# --------------------------------------------------- cross-language contract


def test_the_validation_pattern_matches_the_typescript_half():
    """A validator that disagrees with the other side forks the trace at
    exactly the boundary it exists to cross."""
    ts = (REPO_ROOT / "lib" / "observability" / "requestId.ts").read_text()
    ts_pattern = re.search(r"const VALID_REQUEST_ID = /\^(.+)\$/;", ts)
    assert ts_pattern, "TypeScript pattern not found"
    assert observability._VALID_REQUEST_ID.pattern == f"^{ts_pattern.group(1)}$"


def test_the_header_name_matches_the_typescript_half():
    ts = (REPO_ROOT / "lib" / "observability" / "requestId.ts").read_text()
    assert f'REQUEST_ID_HEADER = "{observability.REQUEST_ID_HEADER}"' in ts


def test_the_middleware_is_installed_on_the_real_app():
    """The whole thing is inert if nobody wires it up."""
    source = (REPO_ROOT / "api" / "index.py").read_text()
    assert "observability.install(app)" in source
