#!/bin/zsh
# Export per-hand root EVs for every flop in flops.txt — the terminal payoffs
# the preflop solve uses. ~187s per flop.
#   ./run-ev.sh <out_dir> [ranges.json]
set -e
cd "$(dirname "$0")"
OUT="${1:-ev}"
RANGES="${2:-ranges-srp-btn-bb.json}"
cargo build --release 2>/dev/null
mkdir -p "$OUT"
while read -r flop; do
  [[ -z "$flop" ]] && continue
  if [[ -f "$OUT/$flop.ev.json" ]]; then
    echo "[$flop] up to date, skipping"
    continue
  fi
  ./target/release/root-ev "$flop" "$OUT" "$RANGES" 2>&1 | grep -v "^iteration"
done < flops.txt
echo "root-ev: all flops done"
