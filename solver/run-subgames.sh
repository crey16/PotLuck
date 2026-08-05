#!/bin/zsh
# Solve root EVs for EVERY postflop subgame of the pruned 6-max preflop tree.
#
#   ./run-subgames.sh <subgame-dir> <out-root> [flops-file]
#
# 30 subgames x 25 flops x ~343s (100% ranges) = ~71 hours. Resumable: an
# existing <out-root>/<spot>/<flop>.ev.json is skipped, so the batch can be
# stopped and restarted without losing work. That matters at this length —
# a non-resumable three-day job is one power cut from starting over.
#
# Memory peaks around 11.2 GB per solve, so these run SEQUENTIALLY on purpose.
# Two concurrent solves would swap on a 16 GB machine and finish slower than
# one at a time.
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
  echo "=== [$n/$total] $spot ==="
  while read -r flop; do
    [[ -z "$flop" ]] && continue
    if [[ -f "$OUTROOT/$spot/$flop.ev.json" ]]; then
      continue
    fi
    ./target/release/root-ev "$flop" "$OUTROOT/$spot" "$cfg" 2>&1 \
      | grep -v "^iteration"
  done < "$FLOPS"
  echo "=== [$n/$total] $spot complete ==="
done
echo "run-subgames: all $total subgames complete"
