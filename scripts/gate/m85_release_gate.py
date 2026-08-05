"""M8.5 release gate — runs the real routes against the real production schema.

    POTLUCK_GATE_OK=1 .venv/bin/python scripts/gate/m85_release_gate.py

WHAT THIS DOES, EXACTLY
-----------------------
It calls the actual FastAPI route functions — not reimplementations — with a
connection whose ``commit()`` is a no-op, then rolls the whole transaction back.
Real SQL runs against the real schema; nothing survives. The final step re-reads
production on a fresh connection and fails loudly if any counter moved.

WHY IT EXISTS
-------------
The Python suites are pure units by design ("no DB, no HTTP"), so the SQL half
of M8.5 had no automated coverage and the release gate was a manual click-through
that stayed unexecuted for a long time. Everything here was on that manual list.

WHAT IT CANNOT COVER
--------------------
Anything that lives in the browser: that sign-UP ignores ``?next=``, that the
nudge renders with the right copy, that the explanation is actually displayed.
Those need a real session and remain manual. See docs/12-m85-status.md.

Requires DATABASE_URL in .env.local (the production pooler string).
"""
from __future__ import annotations

import contextlib
import os
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

for line in (REPO / ".env.local").read_text().splitlines():
    line = line.strip()
    if line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

import psycopg

import api.index as index_mod
import api.learning as learning_mod
import api.placement as placement_mod
import api.scenarios as scenarios_mod
from api.index import AttemptIn, DRILL_STATE_SQL, drill_state, record_attempt
from api.learning import LessonAttemptIn, answerable_screen_indices
from api.placement import (
    ASSESSMENT_VERSION,
    PLACEMENT_QUESTION_COUNT,
    PlacementFinishIn,
    PlacementResponseIn,
    PlacementStartIn,
    complete_placement,
    placement_state,
    record_placement_response,
    skip_placement,
    start_placement,
)
from api.progress import UNSURE_CHOICE_ID
from api.scenarios import ScenarioSubmitIn, submit_scenario, submit_table_scenario
from api.skills import skill_tag_for

# Two existing accounts. ACTIVE has history; FRESH has never answered anything,
# which makes it the closest available stand-in for a new signup.
ACTIVE = "0bef0ae3-4daa-4f48-9d2a-1ad1546169ae"
FRESH = "e134c473-70b5-42fd-a8f9-6b6ffc2b04bb"

PASS: list[str] = []
FAIL: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    (PASS if ok else FAIL).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  — {detail}" if detail else ""))


class NoCommit:
    """Route code thinks it commits; the outer transaction never does."""

    def __init__(self, conn):
        self._conn = conn

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass

    def cursor(self, *a, **k):
        return self._conn.cursor(*a, **k)

    def __getattr__(self, item):
        return getattr(self._conn, item)


@contextlib.contextmanager
def session():
    conn = psycopg.connect(os.environ["DATABASE_URL"], prepare_threshold=None,
                           autocommit=False)
    proxy = NoCommit(conn)

    @contextlib.contextmanager
    def fake_get_connection():
        yield proxy

    for mod in (index_mod, learning_mod, scenarios_mod, placement_mod):
        mod.get_connection = fake_get_connection
    try:
        yield conn.cursor()
    finally:
        conn.rollback()
        conn.close()


def production_counters() -> dict[str, int]:
    with psycopg.connect(os.environ["DATABASE_URL"], prepare_threshold=None) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                select (select count(*) from attempts),
                       (select count(*) from placement_assessments),
                       (select count(*) from placement_responses),
                       (select count(*) from progress),
                       (select count(*) from skill_stats),
                       (select coalesce(sum(xp), 0) from profiles)
            """)
            a, pa, pr, pg, sk, xp = cur.fetchone()
    return {"attempts": a, "placement_assessments": pa, "placement_responses": pr,
            "progress": pg, "skill_stats": sk, "total_xp": xp}


# ---------------------------------------------------------------------
# M8.5C — "Not sure" across all four answer surfaces
# ---------------------------------------------------------------------
def unsure_surfaces() -> None:
    print('\n== M8.5C: "Not sure" across the four answer surfaces ==')
    with session() as raw:
        def profile_xp():
            raw.execute("select xp from profiles where id=%s", (ACTIVE,))
            return raw.fetchone()[0]

        def stats(tag):
            raw.execute("""select total_attempts, correct_attempts, unsure_attempts
                           from skill_stats where user_id=%s and skill_tag=%s""",
                        (ACTIVE, tag))
            return raw.fetchone() or (0, 0, 0)

        def last():
            raw.execute("""select drill_kind, lesson_id, scenario_id, table_scenario_id,
                                  response_type, is_correct
                           from attempts where user_id=%s order by id desc limit 1""",
                        (ACTIVE,))
            return raw.fetchone()

        # --- surface 1: generic drill ---
        tag = skill_tag_for("outs")
        xp0, s0 = profile_xp(), stats(tag)
        record_attempt(
            AttemptIn(drill_kind="outs", drill_payload={"gate": "m85"},
                      answer=UNSURE_CHOICE_ID,
                      is_correct=True,  # the client lies; the server must not believe it
                      response_type="unsure"),
            user_id=ACTIVE)
        row, s1 = last(), stats(tag)
        check("drill: stored as unsure", row[4] == "unsure")
        check("drill: graded incorrect despite the client claiming correct",
              row[5] is False)
        check("drill: earns no XP", profile_xp() == xp0, f"{xp0} -> {profile_xp()}")
        check("drill: skill_stats total +1, correct +0, unsure +1",
              (s1[0], s1[1], s1[2]) == (s0[0] + 1, s0[1], s0[2] + 1),
              f"{s0} -> {s1}")

        # --- surface 2: lesson screen ---
        raw.execute("select id, content_json from lessons where is_active order by id")
        lesson_id = screen = None
        for lid, content in raw.fetchall():
            indices = answerable_screen_indices(content)
            if indices:
                lesson_id, screen = lid, indices[0]
                break
        xp0 = profile_xp()
        record_attempt(LessonAttemptIn(lesson_id=lesson_id, screen_index=screen,
                                       selected_choice_id=UNSURE_CHOICE_ID),
                       user_id=ACTIVE)
        row = last()
        check("lesson: the sentinel is accepted, not rejected as an unknown choice",
              row[4] == "unsure", f"lesson {lesson_id} screen {screen}")
        check("lesson: graded incorrect", row[5] is False)
        check("lesson: linked to the lesson", row[1] == lesson_id)
        check("lesson: earns no XP", profile_xp() == xp0)

        # --- surface 3: authored scenario ---
        raw.execute("select id from scenarios where is_active order by id limit 1")
        sid = raw.fetchone()[0]
        xp0 = profile_xp()
        submit_scenario(ScenarioSubmitIn(scenario_id=sid,
                                         selected_choice_id=UNSURE_CHOICE_ID),
                        user_id=ACTIVE)
        row = last()
        check("scenario: stored as unsure", row[4] == "unsure")
        check("scenario: graded incorrect", row[5] is False)
        check("scenario: linked to the scenario", row[2] == sid)
        check("scenario: earns no XP", profile_xp() == xp0)

        # --- surface 4: table scenario ---
        raw.execute("select id from table_scenarios where is_active order by id limit 1")
        tsid = raw.fetchone()[0]
        xp0 = profile_xp()
        submit_table_scenario(ScenarioSubmitIn(scenario_id=tsid,
                                              selected_choice_id=UNSURE_CHOICE_ID),
                              user_id=ACTIVE)
        row = last()
        check("table scenario: stored as unsure", row[4] == "unsure")
        check("table scenario: graded incorrect", row[5] is False)
        check("table scenario: linked to the table scenario", row[3] == tsid)
        check("table scenario: earns no XP", profile_xp() == xp0)

        # --- a real correct answer must still pay ---
        xp0 = profile_xp()
        record_attempt(AttemptIn(drill_kind="outs", drill_payload={"gate": "m85"},
                                 answer="a", is_correct=True, response_type="answer"),
                       user_id=ACTIVE)
        check("a genuinely correct answer still earns XP",
              profile_xp() > xp0, f"{xp0} -> {profile_xp()}")


# ---------------------------------------------------------------------
# M8.5C — the no-demote rule (pushOutcome / DRILL_STATE_SQL agreement)
# ---------------------------------------------------------------------
def no_demote() -> None:
    print("\n== M8.5C: a run of \"Not sure\" must not demote a drill ==")
    with session() as raw:
        def window():
            raw.execute(DRILL_STATE_SQL, (ACTIVE,))
            return [c for k, c in raw.fetchall() if k == "bluff"]

        before = window()
        for _ in range(8):
            record_attempt(AttemptIn(drill_kind="bluff", drill_payload={"gate": "m85"},
                                     answer=UNSURE_CHOICE_ID, is_correct=False,
                                     response_type="unsure"),
                           user_id=ACTIVE)
        after = window()
        check("8 unsure answers never enter the server difficulty window",
              before == after, f"{len(before)} -> {len(after)} rows")

        raw.execute("""select count(*) from attempts where user_id=%s
                       and drill_kind='bluff' and response_type='unsure'""", (ACTIVE,))
        check("...although the rows really were written", raw.fetchone()[0] == 8)

        before = window()
        record_attempt(AttemptIn(drill_kind="bluff", drill_payload={"gate": "m85"},
                                 answer="a", is_correct=False, response_type="answer"),
                       user_id=ACTIVE)
        check("a committed wrong answer DOES enter the window",
              len(window()) == min(len(before) + 1, index_mod.DRILL_WINDOW_SIZE))


# ---------------------------------------------------------------------
# M8.5B — the placement lifecycle
# ---------------------------------------------------------------------
def placement_lifecycle() -> None:
    def snapshot(raw):
        raw.execute("select xp, level, streak_count from profiles where id=%s", (FRESH,))
        prof = raw.fetchone()
        counts = []
        for table in ("attempts", "skill_stats", "user_daily_activity"):
            raw.execute(f"select count(*) from {table} where user_id=%s", (FRESH,))
            counts.append(raw.fetchone()[0])
        return prof, counts

    print("\n== M8.5B: placement completed (6 of 9, one unsure) ==")
    with session() as raw:
        before = snapshot(raw)
        started = start_placement(PlacementStartIn(seed=424242), user_id=FRESH)
        aid = started["id"]
        check("start writes an in_progress row", started["status"] == "in_progress")

        for i, ch in enumerate("ccccccuww"):
            record_placement_response(
                PlacementResponseIn(assessment_id=aid, question_index=i,
                                    is_correct=(ch == "c"),
                                    response_type="unsure" if ch == "u" else "answer",
                                    answer="x"),
                user_id=FRESH)
        raw.execute("select count(*) from placement_responses where assessment_id=%s", (aid,))
        check("all responses stored", raw.fetchone()[0] == PLACEMENT_QUESTION_COUNT)

        done = complete_placement(PlacementFinishIn(assessment_id=aid), user_id=FRESH)
        levels = done["levels"] or {}
        check("status becomes completed", done["status"] == "completed")
        check("the entry module moves off zero", (done["entry_module_index"] or 0) > 0,
              f"entry_module_index={done['entry_module_index']}")
        check("per-drill level floors are written", bool(levels))
        check("placement never awards level 3",
              all(v <= 2 for v in levels.values()))

        raw.execute("select status, count(*) from progress where user_id=%s group by 1", (FRESH,))
        prog = dict(raw.fetchall())
        check("earlier lessons are marked placed_out", prog.get("placed_out", 0) > 0, f"{prog}")
        check("placement never marks a lesson 'completed'", prog.get("completed", 0) == 0)

        after = snapshot(raw)
        check("XP / level / streak untouched", before[0] == after[0], f"{before[0]} -> {after[0]}")
        check("no attempts / skill_stats / daily-activity row written",
              before[1] == after[1], f"{before[1]} -> {after[1]}")
        check("the account is not asked to place again",
              placement_state(user_id=FRESH)["needs_placement"] is False)
        check("drill-state applies the placement floors",
              drill_state(user_id=FRESH)["placement_levels"] == levels)

        raw.execute("update placement_assessments set assessment_version=%s where id=%s",
                    (ASSESSMENT_VERSION + 1, aid))
        check("an outdated assessment_version stops applying its levels",
              drill_state(user_id=FRESH)["placement_levels"] == {})

    print("\n== M8.5B: placement skipped ==")
    with session() as raw:
        before = snapshot(raw)
        started = start_placement(PlacementStartIn(seed=99), user_id=FRESH)
        skipped = skip_placement(PlacementFinishIn(assessment_id=started["id"]),
                                 user_id=FRESH)
        check("status becomes skipped", skipped["status"] == "skipped")
        check("skip applies no levels", not (skipped["levels"] or {}))
        check("skip leaves the entry module at cold start",
              (skipped["entry_module_index"] or 0) == 0)
        raw.execute("select count(*) from progress where user_id=%s and status='placed_out'",
                    (FRESH,))
        check("skip places nobody out of any lesson", raw.fetchone()[0] == 0)
        check("skip touches no XP or attempts", snapshot(raw) == before)
        check("a skipped account is not asked again",
              placement_state(user_id=FRESH)["needs_placement"] is False)
        check("skip leaves every drill at cold start",
              drill_state(user_id=FRESH)["placement_levels"] == {})

    print("\n== M8.5B: placement abandoned after two answers ==")
    with session() as raw:
        started = start_placement(PlacementStartIn(seed=7), user_id=FRESH)
        for i in range(2):
            record_placement_response(
                PlacementResponseIn(assessment_id=started["id"], question_index=i,
                                    is_correct=True, answer="x"),
                user_id=FRESH)
        state = placement_state(user_id=FRESH)
        check("an abandoned assessment stays in_progress",
              state["assessment"]["status"] == "in_progress")
        check("an abandoned assessment does not re-trigger the redirect",
              state["needs_placement"] is False,
              "the nudge is the only way back — that is why it is load-bearing")


# ---------------------------------------------------------------------
# RLS — one account must never read another's placement history
# ---------------------------------------------------------------------
def rls_isolation() -> None:
    print("\n== RLS: placement history is owner-only ==")
    conn = psycopg.connect(os.environ["DATABASE_URL"], prepare_threshold=None,
                           autocommit=False)
    try:
        with conn.cursor() as cur:
            cur.execute("""insert into placement_assessments
                (user_id, assessment_version, generator_version, seed, status,
                 question_count, scores, levels, entry_module_index, completed_at)
                values (%s, 1, 1, 424242, 'completed', 9, '{}', '{}', 2, now())
                returning id""", (ACTIVE,))
            aid = cur.fetchone()[0]
            cur.execute("""insert into placement_responses
                (assessment_id, question_index, drill_kind, skill_tag,
                 response_type, is_correct, answer)
                values (%s, 0, 'outs', 'counting_outs', 'unsure', false, '__unsure__')""",
                        (aid,))

            def as_user(uid):
                cur.execute("set local role authenticated")
                cur.execute("select set_config('request.jwt.claims', %s, true)",
                            ('{"sub":"%s","role":"authenticated"}' % uid,))

            as_user(ACTIVE)
            cur.execute("select count(*) from placement_assessments where id=%s", (aid,))
            owner_sees = cur.fetchone()[0]
            cur.execute("reset role")

            as_user(FRESH)
            cur.execute("select count(*) from placement_assessments where id=%s", (aid,))
            other_sees = cur.fetchone()[0]
            cur.execute("select count(*) from placement_responses where assessment_id=%s", (aid,))
            other_responses = cur.fetchone()[0]
            cur.execute("reset role")

            check("the owner can read their own assessment", owner_sees == 1)
            check("another account cannot read it, even by id", other_sees == 0)
            check("another account cannot read its responses", other_responses == 0)

            # The refusal aborts the transaction, so probe inside a savepoint —
            # otherwise every later statement dies with InFailedSqlTransaction.
            as_user(FRESH)
            cur.execute("savepoint cross_user_probe")
            try:
                cur.execute("""insert into placement_assessments
                    (user_id, assessment_version, generator_version, seed,
                     status, question_count)
                    values (%s, 1, 1, 1, 'in_progress', 9)""", (ACTIVE,))
                check("WITH CHECK refuses a cross-user insert", False, "the insert succeeded")
            except psycopg.errors.InsufficientPrivilege:
                check("WITH CHECK refuses a cross-user insert", True)
            cur.execute("rollback to savepoint cross_user_probe")
            cur.execute("reset role")
    finally:
        conn.rollback()
        conn.close()


def main() -> int:
    if os.environ.get("POTLUCK_GATE_OK") != "1":
        print(__doc__)
        print("Refusing to run without POTLUCK_GATE_OK=1.")
        return 2

    before = production_counters()
    print(f"production before: {before}")

    unsure_surfaces()
    no_demote()
    placement_lifecycle()
    rls_isolation()

    after = production_counters()
    print(f"\nproduction after:  {after}")
    if before != after:
        moved = {k: (before[k], after[k]) for k in before if before[k] != after[k]}
        check("PRODUCTION IS UNCHANGED", False, f"counters moved: {moved}")
    else:
        check("production is unchanged — every write was rolled back", True)

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    for name in FAIL:
        print(f"  FAILED: {name}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
