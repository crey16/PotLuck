"""Normalise a raw CSV export of Poker_Tracker's Session Log tab into the
flat file scripts/import_poker_tracker.py reads.

    .venv/bin/python scripts/normalize_poker_tracker_export.py \
        scripts/data/poker_tracker_export_raw.csv

The raw export is the sheet's own shape: repeating date blocks (DATE row,
NAMES header, one row per roster name, TOTAL row). This script:
- keeps only rows where the player actually played (a blank row is a
  night off, not a $0 result);
- converts dollars to integer cents by string manipulation, never floats;
- normalises both date formats the sheet uses (7/23/2026 and 8/2/26);
- re-checks every block's TOTAL row against its own rows, and that each
  session balances — the sheet's deliberate grand-total check, re-run;
- skips trailing empty template blocks (no DATE, $0 totals).

Only Session Log facts cross over; every derived tab is recomputed by the
app (docs/19 — the sheet's ROI tab has a live formula bug).
"""
from __future__ import annotations

import csv
import pathlib
import re
import sys

OUT = pathlib.Path(__file__).resolve().parent / "data" / "poker_tracker_session_log.csv"


def money_to_cents(text: str) -> int:
    """'$1,226.00' -> 122600, with no float anywhere."""
    cleaned = text.strip().replace("$", "").replace(",", "")
    negative = cleaned.startswith("-")
    if negative:
        cleaned = cleaned[1:]
    match = re.fullmatch(r"(\d+)(?:\.(\d{1,2}))?", cleaned)
    if not match:
        raise ValueError(f"unparseable amount: {text!r}")
    cents = int(match.group(1)) * 100 + int((match.group(2) or "0").ljust(2, "0"))
    return -cents if negative else cents


def normalise_date(text: str) -> str:
    month, day, year = text.strip().split("/")
    if len(year) == 2:
        year = f"20{year}"
    return f"{year}-{int(month):02d}-{int(day):02d}"


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(f"usage: {sys.argv[0]} <raw export csv>")
    raw = pathlib.Path(sys.argv[1])
    with raw.open(newline="") as f:
        rows = list(csv.reader(f))

    out_rows: list[tuple[str, str, int, int]] = []
    date: str | None = None
    block_in = block_out = 0
    sessions = 0

    for row in rows:
        cells = [c.strip() for c in row] + [""] * 4
        label = cells[0].upper()
        if label == "DATE":
            date = normalise_date(cells[1]) if cells[1] else None
            block_in = block_out = 0
            continue
        if label in ("", "NAMES") or date is None:
            continue
        if label == "TOTAL":
            sheet_in = money_to_cents(cells[1])
            sheet_out = money_to_cents(cells[2])
            if (block_in, block_out) != (sheet_in, sheet_out):
                sys.exit(
                    f"{date}: rows sum to in={block_in} out={block_out} but the "
                    f"sheet's TOTAL says in={sheet_in} out={sheet_out}"
                )
            if block_in != block_out:
                sys.exit(f"{date}: session does not balance ({block_in} vs {block_out})")
            sessions += 1
            date = None
            continue
        # A player row. Blank = didn't play.
        if not cells[1] and not cells[2]:
            continue
        in_cents = money_to_cents(cells[1] or "$0.00")
        out_cents = money_to_cents(cells[2] or "$0.00")
        block_in += in_cents
        block_out += out_cents
        out_rows.append((date, label, in_cents, out_cents))

    OUT.parent.mkdir(exist_ok=True)
    with OUT.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["date", "player", "paid_in_cents", "paid_out_cents"])
        writer.writerows(out_rows)

    players = sorted({r[1] for r in out_rows})
    grand = sum(r[2] for r in out_rows)
    print(
        f"{sessions} sessions, {len(players)} players, {len(out_rows)} "
        f"appearances, ${grand / 100:,.2f} through the books -> {OUT}"
    )


if __name__ == "__main__":
    main()
