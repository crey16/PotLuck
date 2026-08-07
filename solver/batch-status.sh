#!/bin/zsh
# What is the subgame batch actually doing?
#
#   ./solver/batch-status.sh
#
# The batch is launched detached (nohup + disown), so it reparents to init and
# does NOT appear in any shell's job list. Its log and its output are both
# git-ignored, so `git status` stays clean while it works. Between those two
# facts a multi-day run is completely invisible unless you go looking — which
# is what this is for.
#
# COMPLETION IS A COUNT, NEVER AN EXIT STATUS. See docs/14-m87a-solver-scope.md:
# a batch has already been silently truncated twice in this project, and both
# times it looked exactly like a batch that had not started.
cd "$(dirname "$0")"

FLOPS=$(wc -l < flops.txt | tr -d ' ')
SUBGAMES=$(ls subgames/*.json | wc -l | tr -d ' ')
TOTAL=$((SUBGAMES * FLOPS))
DONE=$(ls ev-all/*/*.ev.json 2>/dev/null | wc -l | tr -d ' ')

print -r -- "── subgame batch ─────────────────────────────────"

if pgrep -f "run-subgames.sh" > /dev/null; then
  ELAPSED=$(ps -eo etime,command | grep "[r]un-subgames.sh" | head -1 | awk '{print $1}')
  print -r -- "  RUNNING, up ${ELAPSED}"
  CURRENT=$(ps -eo command | grep "[r]oot-ev" | head -1 | awk '{print $2, $3}')
  [[ -n "$CURRENT" ]] && print -r -- "  solving: ${CURRENT}"
else
  # Not running is not the same as finished, and the difference matters:
  # re-running is cheap and skips whatever is already on disk.
  if (( DONE == TOTAL )); then
    print -r -- "  COMPLETE"
  else
    print -r -- "  NOT RUNNING — and not finished. Resume with:"
    print -r -- "    nohup ./solver/run-subgames.sh subgames ev-all >> solver/batch-m87a.log 2>&1 & disown"
  fi
fi

print -r -- "  flops: ${DONE} / ${TOTAL}"

# Per-subgame progress. Only a subgame at ${FLOPS}/${FLOPS} may be read: the
# partial-batch rule in docs/14 applies per subgame, and a partial average
# will manufacture a trend that is not there.
COMPLETE=0
for dir in ev-all/*/(N); do
  n=$(ls ${dir}*.ev.json 2>/dev/null | wc -l | tr -d ' ')
  if (( n == FLOPS )); then
    COMPLETE=$((COMPLETE + 1))
  else
    print -r -- "  in progress: ${dir:t} ${n}/${FLOPS}"
  fi
done
print -r -- "  subgames complete (safe to read): ${COMPLETE} / ${SUBGAMES}"

# Observed rate, not the estimate. The estimate in docs/14 was 343s/flop and
# the real run has been running at roughly twice that, so the projection is
# taken from what actually happened.
if [[ -f batch-m87a.log ]]; then
  grep -o "in [0-9]*s" batch-m87a.log | grep -o "[0-9]*" | awk -v done="$DONE" -v total="$TOTAL" '
    {t[NR] = $1}
    END {
      if (NR == 0) exit
      r = 0; c = 0
      for (i = NR - 19; i <= NR; i++) if (i > 0) { r += t[i]; c++ }
      mean = r / c
      left = (total - done) * mean / 3600
      printf "  recent mean: %.0fs/flop  →  ~%.0fh (%.1f days) left at this rate\n", mean, left, left / 24
    }'
fi
print -r -- "  log: solver/batch-m87a.log"
