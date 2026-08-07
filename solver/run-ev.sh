#!/bin/zsh
# Export per-hand root EVs for every flop in flops.txt — the terminal payoffs
# the preflop solve uses. ~300-900s per flop.
#   ./run-ev.sh <out_dir> [ranges.json] [flops-file]
#
# ALWAYS LAUNCH DETACHED:  nohup ./run-ev.sh ev/iterN ranges-iterN.json &
# A batch started as a child of an interactive or tool-managed shell dies with
# that shell. This has silently truncated a run twice — see
# docs/14-m87a-solver-scope.md. Completion is `ls <out>/*.ev.json | wc -l`
# against `wc -l < flops.txt`, never the exit status of this script.
#
# Re-running is safe and cheap: a flop with an existing .ev.json is skipped, so
# resuming costs only the flops actually missing.
set -e
cd "$(dirname "$0")"
OUT="${1:-ev}"
RANGES="${2:-ranges-srp-btn-bb.json}"
# A plain flop list, one board per line. Weighted sets live in solver/flops/
# as JSON with per-flop weights; `flops/list.ts` extracts the boards for this
# script. The WEIGHTS never enter here — solving one board does not depend on
# how much that board counts, only the averaging does.
FLOPS="${3:-flops.txt}"
cargo build --release 2>/dev/null
mkdir -p "$OUT"
while read -r flop; do
  [[ -z "$flop" ]] && continue
  if [[ -f "$OUT/$flop.ev.json" ]]; then
    echo "[$flop] up to date, skipping"
    continue
  fi
  # The solver's status is checked DIRECTLY rather than through a pipe. It used
  # to be `root-ev ... | grep -v "^iteration"`, and without pipefail the
  # script's status is grep's: a flop whose output happened to be nothing but
  # iteration lines would make grep exit 1 and `set -e` would kill the whole
  # batch after that flop. Over a multi-day run that is a silent truncation.
  if ! ./target/release/root-ev "$flop" "$OUT" "$RANGES" > "$OUT/$flop.run.log" 2>&1; then
    status=$?
    echo "[$flop] SOLVER FAILED (exit $status) — see $OUT/$flop.run.log"
    exit "$status"
  fi
  grep -v "^iteration" "$OUT/$flop.run.log" || true
done < "$FLOPS"
echo "root-ev: all flops done"
