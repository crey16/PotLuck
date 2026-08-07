#!/bin/zsh
# Solve root EVs for EVERY postflop subgame of the pruned 6-max preflop tree.
#
#   ./run-subgames.sh <subgame-dir> <out-root> [flops-file]
#
# ALWAYS LAUNCH DETACHED:
#   nohup ./run-subgames.sh subgames ev-all > batch.log 2>&1 &  disown
#
# 60 subgames x 25 flops x ~343s (100% ranges) = ~143 hours. A batch of that
# length cannot survive being a child of an interactive or tool-managed shell;
# it has been silently truncated twice already. See docs/14-m87a-solver-scope.md.
#
# COMPLETION IS A COUNT, NOT AN EXIT STATUS:
#   ls ev-all/*/*.ev.json | wc -l   against   60 * $(wc -l < flops.txt)
#
# Resumable: an existing <out-root>/<spot>/<flop>.ev.json is skipped, so the
# batch can be stopped and restarted without losing work. That matters at this
# length — a non-resumable multi-day job is one power cut from starting over.
#
# Memory peaks around 11.2 GB per solve, so these run SEQUENTIALLY on purpose.
# Two concurrent solves would swap on a 16 GB machine and finish slower than
# one at a time.
#
# ORDER MATTERS. `subgames/*.json` sorts l1 before l2 before l3, so the fifteen
# level-1 subgames — every position pair in a single-raised pot, which is what
# unlocks hero position on the setup screen — complete first, at roughly 36 of
# the 143 hours. A partial batch is therefore useful rather than merely
# incomplete, provided you only read COMPLETE subgames (the partial-batch rule
# in docs/14 applies per subgame: a subgame averaged over 18 of 25 flops moved
# BB by 4.8 points against its complete self).
set -e
cd "$(dirname "$0")"
SUBGAMES="${1:-subgames}"
OUTROOT="${2:-ev-all}"
FLOPS="${3:-flops.txt}"

cargo build --release 2>/dev/null
mkdir -p "$OUTROOT"

total=$(ls "$SUBGAMES"/*.json | wc -l | tr -d ' ')
n=0
for cfg in "$SUBGAMES"/*.json; do
  spot="${cfg:t:r}"
  n=$((n + 1))
  mkdir -p "$OUTROOT/$spot"
  echo "=== [$n/$total] $spot === $(date -u +%FT%TZ)"
  while read -r flop; do
    [[ -z "$flop" ]] && continue
    if [[ -f "$OUTROOT/$spot/$flop.ev.json" ]]; then
      continue
    fi
    # The solver's status is checked DIRECTLY rather than through a pipe. It
    # used to be `root-ev ... | grep -v "^iteration"`, and without pipefail the
    # loop's status is grep's: a flop whose output happened to be nothing but
    # iteration lines would make grep exit 1 and `set -e` would kill the whole
    # batch after that flop. Over a multi-day run that is a silent truncation,
    # and it is indistinguishable from a batch that has not started — this is
    # the exact bug already fixed in run-ev.sh.
    if ! ./target/release/root-ev "$flop" "$OUTROOT/$spot" "$cfg" \
        > "$OUTROOT/$spot/$flop.run.log" 2>&1; then
      status=$?
      echo "[$spot/$flop] SOLVER FAILED (exit $status) — see $OUTROOT/$spot/$flop.run.log"
      exit "$status"
    fi
    grep -v "^iteration" "$OUTROOT/$spot/$flop.run.log" || true
  done < "$FLOPS"
  echo "=== [$n/$total] $spot complete === $(date -u +%FT%TZ)"
done
echo "run-subgames: all $total subgames complete"
