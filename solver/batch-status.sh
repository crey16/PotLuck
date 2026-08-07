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

# Observed rate — reported as a MEDIAN, and this matters more than it looks.
#
# The solve saturates ~10 cores, so anything else heavy on this machine
# stretches it badly. During M8.7 development the same flops that took ~250s
# on an idle machine took 1100-2300s while `npm test` and the push/fold solver
# were running. A MEAN over that window read ~900s and projected 15 days for a
# pass, which was measuring the interference rather than the batch — and two
# independent measures (summed solve times, wall clock) agreed with each
# other because both were contaminated the same way.
#
# The median is robust to those spikes. The min is printed beside it as the
# clean-machine floor: if the median sits far above the min, something else is
# competing for the CPU and the projection is pessimistic, not real.
if [[ -f batch-m87a.log ]]; then
  grep -o "in [0-9]*s" batch-m87a.log | grep -o "[0-9]*" | awk -v done="$DONE" -v total="$TOTAL" '
    {t[NR] = $1}
    END {
      if (NR == 0) exit
      # Last 12 solves, sorted, median.
      n = 0
      for (i = NR - 11; i <= NR; i++) if (i > 0) w[++n] = t[i]
      for (i = 1; i < n; i++) for (j = i + 1; j <= n; j++) if (w[j] < w[i]) { x = w[i]; w[i] = w[j]; w[j] = x }
      med = w[int(n / 2) + 1]
      left = (total - done) * med / 3600
      printf "  recent median: %ds/flop (fastest seen %ds)\n", med, w[1]
      printf "  →  ~%.0fh (%.1f days) left at this rate\n", left, left / 24
      if (med > w[1] * 2) {
        printf "  NOTE: median is %.1fx the fastest solve — something else is using the CPU,\n", med / w[1]
        printf "        so this projection is pessimistic. Re-check on an idle machine.\n"
      }
    }'
fi
print -r -- "  log: solver/batch-m87a.log"
