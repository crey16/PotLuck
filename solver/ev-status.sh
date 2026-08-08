#!/bin/zsh
# What is a run-ev.sh pass actually doing?
#
#   ./solver/ev-status.sh [out_dir] [flops-file]
#
# The companion to batch-status.sh, for the other long job in this folder. Same
# problem, same reason it needs solving: run-ev.sh is launched detached, its log
# and its output are both git-ignored, and `git status` stays clean while it
# works. With no terminal attached to it a multi-hour pass is invisible.
#
# With no arguments this reads the arguments off the RUNNING run-ev.sh, so the
# common case is to just run it. Pass them explicitly to inspect a finished or
# stopped pass.
#
# COMPLETION IS A COUNT, NEVER AN EXIT STATUS — run-ev.sh says so itself, and
# docs/14-m87a-solver-scope.md records the two truncations that taught it.
cd "$(dirname "$0")"
source ./proc.sh  # proc_running — NOT pgrep -f; see that file for why

OUT="$1"
FLOPS="$2"

# Recover the pass from the process table when not told. run-ev.sh's argv is
# `run-ev.sh <out> [ranges] [flops]`, and its defaults have to be repeated here
# because a default never appears in argv.
if [[ -z "$OUT" ]] && proc_running run-ev.sh; then
  OUT=$(proc_script_argv run-ev.sh 2)
  FLOPS=$(proc_script_argv run-ev.sh 4)
fi
OUT="${OUT:-ev}"
FLOPS="${FLOPS:-flops.txt}"

if [[ ! -f "$FLOPS" ]]; then
  print -r -- "no such flop list: $FLOPS" >&2
  exit 1
fi

TOTAL=$(grep -c . "$FLOPS" | tr -d ' ')
DONE=$(ls "$OUT"/*.ev.json 2>/dev/null | wc -l | tr -d ' ')

print -r -- "── ev pass: ${OUT} ───────────────────────────────"

if proc_running run-ev.sh; then
  print -r -- "  RUNNING, up $(proc_elapsed run-ev.sh)"
  CURRENT=$(proc_argv root-ev 1)
  [[ -n "$CURRENT" ]] && print -r -- "  solving: ${CURRENT}"
else
  if (( DONE >= TOTAL )); then
    print -r -- "  COMPLETE"
  else
    print -r -- "  NOT RUNNING — and not finished. Resume with:"
    print -r -- "    nohup ./solver/run-ev.sh ${OUT} <ranges.json> ${FLOPS} >> solver/<name>.log 2>&1 & disown"
    print -r -- "  (re-running is cheap: a flop with an .ev.json is skipped)"
  fi
fi

print -r -- "  flops: ${DONE} / ${TOTAL}"

# Which boards are outstanding — the list a resume would actually solve. This is
# the honest gap: a count alone cannot tell a pass that is 34 short of the list
# from a pass that solved 34 boards which are not on it.
MISSING=(${(f)"$(comm -23 \
  <(tr -d ' \r' < "$FLOPS" | grep -v '^$' | sort) \
  <(ls "$OUT"/*.ev.json 2>/dev/null | xargs -n1 basename 2>/dev/null | sed 's/\.ev\.json$//' | sort))"})
MISSING=(${MISSING:#})
if (( $#MISSING )); then
  print -r -- "  outstanding (${#MISSING}): ${MISSING[1,12]}${${:-...}:+$( (( $#MISSING > 12 )) && print -n ' ...')}"
fi

# Anything on disk that the list does not ask for. A mid-run overwrite of the
# flop list leaves exactly this trace, and it is otherwise silent.
STRAY=$(comm -13 \
  <(tr -d ' \r' < "$FLOPS" | grep -v '^$' | sort) \
  <(ls "$OUT"/*.ev.json 2>/dev/null | xargs -n1 basename 2>/dev/null | sed 's/\.ev\.json$//' | sort) | grep -c .)
(( STRAY > 0 )) && print -r -- "  NOTE: ${STRAY} .ev.json not on this flop list — the list changed under the run."

# Observed rate, from the per-board run logs rather than the aggregate log,
# because where stdout was redirected is not recoverable from the process table.
# Median for the same reason batch-status.sh uses one: the solve saturates ~10
# cores, so a competing job stretches individual solves badly and a mean
# measures the interference instead of the batch.
RECENT=(${(f)"$(ls -t "$OUT"/*.run.log 2>/dev/null | head -12)"})
if (( $#RECENT )); then
  grep -ho "in [0-9]*s" $RECENT 2>/dev/null | grep -o "[0-9]*" | awk -v left="$(( TOTAL - DONE ))" '
    {t[NR] = $1}
    END {
      if (NR == 0) exit
      for (i = 1; i < NR; i++) for (j = i + 1; j <= NR; j++) if (t[j] < t[i]) { x = t[i]; t[i] = t[j]; t[j] = x }
      med = t[int(NR / 2) + 1]
      printf "  recent median: %ds/flop (fastest seen %ds)\n", med, t[1]
      if (left > 0) printf "  →  ~%.1fh left at this rate\n", left * med / 3600
      if (med > t[1] * 2)
        printf "  NOTE: median is %.1fx the fastest solve — something else is using the CPU.\n", med / t[1]
    }'
fi
