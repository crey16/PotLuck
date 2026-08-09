"""Request tracing and timing for the FastAPI half — M8.8A.

One JSON line per request on stdout, in the same shape
`lib/observability/log.ts` emits, so `scripts/perf-baseline.ts --ingest` reads
both halves of the system with one parser.

## The request id

Adopted from the ``x-request-id`` header when the browser sent a valid one, and
minted otherwise. Adoption is the whole point: the browser holds the trace (see
`lib/observability/clientTrace.ts` for why it has to — after M8.8C nothing on
the server calls anything else on the server), so a call arriving here already
carrying ``9f3c…-2`` belongs to a document render logged as ``9f3c…-0``.
Minting a fresh id here instead would break exactly the join this exists to
create.

Validation mirrors the TypeScript rule character for character
(``[A-Za-z0-9_-]{8,64}``) — ``test_observability.py`` pins the two patterns
together. Anything else is replaced, not recorded: an unvalidated header is a
free write into a log file, and a newline in it splits one line into two.

## The route key

``scope["route"].path`` — Starlette's own matched template, e.g.
``/api/play/hands/{hand_id}``. Taken from the router rather than from a regex
list in this file, because a hand-maintained copy of the route table drifts;
CLAUDE.md records that happening to `docs/03-api-surface.md`, which is why the
API's decorators are now the only truth about the API. An unmatched request
logs ``unmatched``, so a 404 flood adds one row rather than one row per URL.

**The raw path and the query string are never logged.** ``?q=`` on user search
carries whatever someone typed, and the path of an unmatched request is
attacker-chosen.

## Cold and warm

``_served`` counts requests this *process* has handled. The first one is
``cold: True`` and additionally reports ``boot_ms`` — the wall time from module
import to that request starting, which is the part of a Vercel cold start this
code can actually see. It does not include the platform's container start, so
it is a floor on cold-start cost and is labelled as one in the report.

Cold and warm observations are never pooled into one distribution downstream
(`lib/observability/stats.ts` keeps them apart), because a 300–800ms runtime
boot describes no warm request.

## What is never logged

No user id, no bearer token, no request body, no response body, no cookie, no
query string. ``current_user_id`` runs inside the route, and this middleware
deliberately never looks at the result: a performance log that identifies the
person behind each line is a different, much more sensitive artifact.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import sys
import time
from typing import Any, Callable

# Must equal VALID_REQUEST_ID in lib/observability/requestId.ts.
# test_observability.py reads that file and asserts the two agree.
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")

REQUEST_ID_HEADER = "x-request-id"

# Monotonic clock for durations, wall clock only for "when did this process
# start" — never mixed inside one subtraction.
_IMPORTED_AT = time.perf_counter()
_served = 0


def is_valid_request_id(value: str | None) -> bool:
    return bool(value) and bool(_VALID_REQUEST_ID.match(value or ""))


def new_request_id() -> str:
    """A 16-hex trace at hop 0, matching `requestIdFor(newTraceId(), 0)`.

    ``secrets`` rather than ``random``: the id is echoed in a response header
    and ends up in pasted bug reports, so neighbouring ids must not be
    guessable from one of them.
    """
    return f"{secrets.token_hex(8)}-0"


def resolve_request_id(incoming: str | None) -> tuple[str, bool]:
    """Return ``(request_id, generated)``."""
    if is_valid_request_id(incoming):
        return incoming, False  # type: ignore[return-value]
    return new_request_id(), True


def trace_of(request_id: str) -> str:
    """The join key — everything before a trailing ``-<digits>`` hop."""
    cut = request_id.rfind("-")
    if cut <= 0:
        return request_id
    hop = request_id[cut + 1 :]
    return request_id[:cut] if hop.isdigit() and len(hop) <= 4 else request_id


def perf_logging_enabled() -> bool:
    """Opt-out in development, opt-in elsewhere — mirrors `log.ts`.

    Vercel bills log volume and this project has no sampling infrastructure, so
    production stays quiet until someone opens a measurement window with
    ``PERF_LOG=1``. An empty production table then means "nobody turned it on",
    which is a knowable answer, rather than a silent drop.
    """
    flag = os.environ.get("PERF_LOG")
    if flag in ("1", "true"):
        return True
    if flag in ("0", "false"):
        return False
    return os.environ.get("VERCEL_ENV") is None


def format_event(event: dict[str, Any]) -> str:
    """Serialize one line. Separate from emission so tests need no stdout."""
    ordered = {key: value for key, value in event.items() if value is not None}
    # ``separators`` keeps the line compact; ``ensure_ascii`` keeps it one line
    # even if a value somehow contained a non-ASCII character.
    return json.dumps(ordered, separators=(",", ":"), ensure_ascii=True)


def emit(event: dict[str, Any]) -> None:
    if not perf_logging_enabled():
        return
    try:
        print(format_event(event), file=sys.stdout, flush=False)
    except Exception:
        # Instrumentation must never fail the request it is measuring.
        pass


def route_key(request: Any) -> str:
    """Starlette's matched route template, or ``unmatched``."""
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    if isinstance(path, str) and path:
        return path
    return "unmatched"


def install(app: Any) -> None:
    """Attach the tracing middleware to a FastAPI app."""

    @app.middleware("http")
    async def trace_requests(request: Any, call_next: Callable) -> Any:
        global _served

        request_id, generated = resolve_request_id(
            request.headers.get(REQUEST_ID_HEADER)
        )
        # Readable by the route through ``request.state`` — nothing needs it
        # today, but a handler that logs its own line must use THIS id rather
        # than mint a second one, which is the fork this attribute prevents.
        request.state.request_id = request_id

        is_cold = _served == 0
        _served += 1

        started = time.perf_counter()
        status = 500
        error: str | None = None
        try:
            response = await call_next(request)
            status = response.status_code
        except Exception as exc:  # pragma: no cover - re-raised unchanged
            error = type(exc).__name__
            raise
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            event: dict[str, Any] = {
                "evt": "api.request",
                "rid": request_id,
                "trace": trace_of(request_id),
                "route": route_key(request),
                "method": request.method,
                "ms": round(elapsed_ms, 1),
                "status": status,
                "cold": is_cold,
            }
            if generated:
                # Flagged so a reader can tell an untraced client call from a
                # broken propagation, instead of guessing from a lonely trace.
                event["origin"] = "generated"
            if is_cold:
                event["boot_ms"] = round((started - _IMPORTED_AT) * 1000, 1)
            if error:
                event["error"] = error[:120]
            emit(event)

        response.headers[REQUEST_ID_HEADER] = request_id
        # Exposed to browser JS. The response is same-origin in this app, but
        # the header is worth reading from a fetch during debugging and CORS
        # hides it by default otherwise. The value is random and carries no
        # identity, so exposing it discloses nothing.
        existing = response.headers.get("access-control-expose-headers")
        response.headers["access-control-expose-headers"] = (
            f"{existing}, {REQUEST_ID_HEADER}" if existing else REQUEST_ID_HEADER
        )
        return response
