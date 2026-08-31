"""One-off import of the Poker_Tracker Google Sheet into the home-game
tracker (M15, docs/19).

    .venv/bin/python scripts/import_poker_tracker.py \
        --owner-user-id <uuid> [--group-name "Home Game"] [--dry-run]

Input: scripts/data/poker_tracker_session_log.csv (git-ignored — it is real
people's money), one row per player-appearance, normalised from the sheet's
Session Log tab ONLY:

    date,player,paid_in_cents,paid_out_cents
    2026-07-23,COLLIN,22000,26200

Rules from docs/19, all enforced here:
- Only Session Log facts are imported. Every derived tab (Summary, the
  leaderboards) is recomputed by the app — the sheet's ROI tab has a live
  formula bug, which is exactly why nothing derived crosses over.
- Sheet totals are night TOTALS, not events: each becomes ONE lump entry
  per direction flagged imported=true, so it is never mistaken for
  observed rebuy timing.
- Players become identities with stable ids, title-cased for display, and
  are NEVER merged by name similarity — SAHIL and SAHIR are two people.
- Every session must balance in/out to exactly $0.00 before anything is
  written, and the whole import is one transaction.
- Nothing here touches attempts, skill_stats, XP or any training table.

Idempotence: refuses to run if the owner already owns a group of this name.
"""
from __future__ import annotations

import argparse
import csv
import os
import pathlib
import sys
from collections import defaultdict

REPO = pathlib.Path(__file__).resolve().parent.parent
CSV_PATH = REPO / "scripts" / "data" / "poker_tracker_session_log.csv"

# .env.local the same way scripts/gate/m85_release_gate.py does.
for line in (REPO / ".env.local").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"'))

sys.path.insert(0, str(REPO))

from api.db import get_connection  # noqa: E402
from api.games import new_invite_code, title_case_name  # noqa: E402


def load_rows() -> list[dict[str, str]]:
    if not CSV_PATH.exists():
        sys.exit(f"missing {CSV_PATH} — export the sheet's Session Log first")
    with CSV_PATH.open(newline="") as f:
        rows = list(csv.DictReader(f))
    expected = {"date", "player", "paid_in_cents", "paid_out_cents"}
    if rows and set(rows[0]) != expected:
        sys.exit(f"csv columns must be exactly {sorted(expected)}")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--owner-user-id", required=True)
    parser.add_argument("--group-name", default="Home Game")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    rows = load_rows()

    # session date -> player NAME (sheet caps) -> [in_cents, out_cents]
    sessions: dict[str, dict[str, list[int]]] = defaultdict(dict)
    for row in rows:
        name = row["player"].strip()
        in_cents = int(row["paid_in_cents"])
        out_cents = int(row["paid_out_cents"])
        if name in sessions[row["date"]]:
            sys.exit(f"duplicate row: {name} on {row['date']}")
        if in_cents < 0 or out_cents < 0:
            sys.exit(f"negative amount: {name} on {row['date']}")
        sessions[row["date"]][name] = [in_cents, out_cents]

    # The sheet's deliberate grand-total check, re-run before anything is
    # written: every session balances to exactly $0.00.
    for date, players in sorted(sessions.items()):
        total_in = sum(v[0] for v in players.values())
        total_out = sum(v[1] for v in players.values())
        if total_in != total_out:
            sys.exit(
                f"{date} does not balance: in {total_in} vs out {total_out} "
                "— fix the export, nothing was written"
            )

    all_names = sorted({n for players in sessions.values() for n in players})
    appearances = sum(len(p) for p in sessions.values())
    grand_in = sum(v[0] for p in sessions.values() for v in p.values())
    print(
        f"{len(sessions)} sessions, {len(all_names)} players, "
        f"{appearances} appearances, ${grand_in / 100:,.2f} through the books"
    )
    if args.dry_run:
        for name in all_names:
            print(f"  roster: {title_case_name(name)}")
        print("dry run — nothing written")
        return

    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "select 1 from profiles where id = %s", (args.owner_user_id,)
                )
                if cur.fetchone() is None:
                    sys.exit("owner user id not found — nothing written")
                cur.execute(
                    """
                    select 1 from poker_groups
                    where owner_user_id = %s and name = %s
                    """,
                    (args.owner_user_id, args.group_name),
                )
                if cur.fetchone() is not None:
                    sys.exit(
                        f"{args.owner_user_id} already owns a group named "
                        f"{args.group_name!r} — refusing to import twice"
                    )

                cur.execute(
                    """
                    insert into poker_groups (name, owner_user_id, invite_code)
                    values (%s, %s, %s) returning id
                    """,
                    (args.group_name, args.owner_user_id, new_invite_code()),
                )
                group_id = cur.fetchone()[0]
                cur.execute(
                    """
                    insert into group_members (group_id, user_id, role)
                    values (%s, %s, 'owner')
                    """,
                    (group_id, args.owner_user_id),
                )

                # Roster: one identity per distinct sheet name, unclaimed.
                # (The owner claims theirs in the UI — the claim inherits
                # the whole imported history because it hangs off the id.)
                player_ids: dict[str, str] = {}
                for name in all_names:
                    cur.execute(
                        """
                        insert into group_players (group_id, display_name)
                        values (%s, %s) returning id
                        """,
                        (group_id, title_case_name(name)),
                    )
                    player_ids[name] = cur.fetchone()[0]

                for date, players in sorted(sessions.items()):
                    # Noon ET on the session date: an explicitly artificial
                    # timestamp, matching the imported=true lump semantics.
                    occurred_at = f"{date}T12:00:00-04:00"
                    cur.execute(
                        """
                        insert into game_sessions
                            (group_id, session_date, currency, status,
                             started_at, ended_at, settled_at, created_by)
                        values (%s, %s, 'USD', 'settled', %s, %s, %s, %s)
                        returning id
                        """,
                        (
                            group_id,
                            date,
                            occurred_at,
                            occurred_at,
                            occurred_at,
                            args.owner_user_id,
                        ),
                    )
                    session_id = cur.fetchone()[0]
                    for name, (in_cents, out_cents) in players.items():
                        cur.execute(
                            """
                            insert into session_players (session_id, player_id)
                            values (%s, %s)
                            """,
                            (session_id, player_ids[name]),
                        )
                        # amount_cents > 0 is a schema check; a zero side
                        # (busted, or a freeroll) is simply no entry.
                        if in_cents > 0:
                            cur.execute(
                                """
                                insert into session_entries
                                    (session_id, player_id, direction, kind,
                                     amount_cents, occurred_at, imported,
                                     created_by)
                                values (%s, %s, 'in', 'buyin', %s, %s, true, %s)
                                """,
                                (
                                    session_id,
                                    player_ids[name],
                                    in_cents,
                                    occurred_at,
                                    args.owner_user_id,
                                ),
                            )
                        if out_cents > 0:
                            cur.execute(
                                """
                                insert into session_entries
                                    (session_id, player_id, direction, kind,
                                     amount_cents, occurred_at, imported,
                                     created_by)
                                values (%s, %s, 'out', 'cashout', %s, %s, true, %s)
                                """,
                                (
                                    session_id,
                                    player_ids[name],
                                    out_cents,
                                    occurred_at,
                                    args.owner_user_id,
                                ),
                            )
        except Exception:
            conn.rollback()
            raise
        conn.commit()

    print(f"imported into group {group_id}")


if __name__ == "__main__":
    main()
