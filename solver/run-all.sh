#!/bin/zsh
# Solve and export every flop in flops.txt. ~75s per flop on an M4 Pro.
# Usage: ./run-all.sh [n_instances] [seed]
set -e
cd "$(dirname "$0")"
N="${1:-200}"
SEED="${2:-1}"
cargo build --release 2>/dev/null
while read -r flop; do
  [[ -z "$flop" ]] && continue
  # Skip only artifacts newer than the exporter binary — a rebuilt exporter
  # must invalidate every stale artifact, or publish.sh ships old data.
  if [[ -f "out/$flop.json.gz" && "out/$flop.json.gz" -nt target/release/potluck-solver ]]; then
    echo "[$flop] up to date, skipping"
    continue
  fi
  ./target/release/potluck-solver "$flop" out ranges-srp-btn-bb.json "$N" "$SEED" 2>&1 \
    | grep -v "^iteration"
done < flops.txt
echo "all done"
