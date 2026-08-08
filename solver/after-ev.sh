#!/bin/zsh
# Chain the subgame batch behind a running EV pass, so the machine is never
# idle between them and never running both at once.
#
#   nohup ./solver/after-ev.sh <out_dir> <ranges.json> <flops-file> & disown
#
# Why this exists as a SCRIPT and not as a shell one-liner: the previous chain
# was a background job owned by an interactive session, and it died with that
# session's terminal — silently, leaving a pass that would finish 34 boards
# short of its list with nobody left to notice. Anything that must outlive a
# terminal has to be detached and on disk. Same lesson as run-ev.sh's header,
# one level up.
#
# The two jobs are serialised deliberately. A root-ev solve saturates ~10 cores;
# running the EV pass and the subgame batch together does not finish them any
# sooner, and it corrupts the batch's own rate measurement — see the long note
# in batch-status.sh about a mean that read 900s/flop and was measuring `npm
# test` rather than the batch.
set -u
cd "$(dirname "$0")"
source ./proc.sh  # proc_running — NOT pgrep -f; see that file for why

OUT="${1:?usage: after-ev.sh <out_dir> <ranges.json> <flops-file>}"
RANGES="${2:?}"
FLOPS="${3:?}"
LOG="${4:-chain.log}"

TOTAL=$(grep -c . "$FLOPS" | tr -d ' ')
count() { ls "$OUT"/*.ev.json 2>/dev/null | wc -l | tr -d ' ' }
say() { print -r -- "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG" }

say "watching ${OUT} for ${TOTAL} flops from ${FLOPS}"

# 1. Wait out whatever pass is already running. Polling the process table is
#    the only option: this script did not start that pass and has no child to
#    wait on. The test must be proc_running and not `pgrep -f run-ev.sh` — with
#    pgrep this loop waits on any shell that merely mentions the name, which on
#    2026-08-07 meant waiting on a leftover wrapper that was itself deadlocked
#    on the same false match. proc.sh has the full account.
while proc_running run-ev.sh; do sleep 120; done
say "run-ev.sh has exited at $(count)/${TOTAL}"

# 2. Fill the gap. The count is the completion test, never the exit status, so
#    this re-runs until the count is right — but only while re-running is
#    actually achieving something. A board that fails deterministically would
#    otherwise spin here forever.
attempt=0
while (( $(count) < TOTAL )); do
  before=$(count)
  attempt=$((attempt + 1))
  if (( attempt > 3 )); then
    say "STOPPING: still ${before}/${TOTAL} after 3 gap-fill attempts"
    exit 1
  fi
  say "gap-fill attempt ${attempt} from ${before}/${TOTAL}"
  ./run-ev.sh "$OUT" "$RANGES" "$FLOPS" >> "$LOG" 2>&1 || say "run-ev.sh exited nonzero — see ${LOG}"
  if (( $(count) == before )); then
    say "STOPPING: gap-fill made no progress at ${before}/${TOTAL}. A board is failing;"
    say "          the batch is NOT being started, so the failure stays diagnosable."
    exit 1
  fi
done
say "ev pass COMPLETE: $(count)/${TOTAL}"

# 3. Hand the machine to the batch.
if proc_running run-subgames.sh; then
  say "subgame batch is already running — nothing to start"
  exit 0
fi
nohup ./run-subgames.sh subgames ev-all >> batch-m87a.log 2>&1 &
disown
say "subgame batch launched (pid $!) — watch it with ./solver/batch-status.sh"
