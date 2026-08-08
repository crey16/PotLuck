# Is one of this folder's long jobs actually running?
#
#   source "$(dirname "$0")/proc.sh"
#   proc_running run-ev.sh && ...
#
# WHY THIS IS NOT `pgrep -f run-ev.sh`
#
# `pgrep -f` matches the pattern against the WHOLE command line, so it also
# matches any shell whose command line merely MENTIONS the script — a
# `zsh -c 'while pgrep -f run-ev.sh; do sleep 60; done'` wrapper contains the
# string, and so does the `grep` you typed to look for it.
#
# This is not hypothetical. On 2026-08-07 two wrapper shells outlived the
# terminal that spawned them, and between them they produced three failures at
# once: one wrapper's wait loop matched ITSELF and deadlocked forever; the
# chain script waited on that wrapper believing it was the solver, so the
# subgame batch never started after the EV pass finished; and ev-status.sh
# reported "RUNNING" for a run-ev.sh that had already printed "all flops done"
# and exited. Every one of them looked like a job that was still working.
#
# So: match argv[1]'s BASENAME instead. A script's own process has its path
# there (`/bin/zsh ./run-ev.sh ev/... ranges.json`), while a `zsh -c` wrapper
# has the literal `-c`, whatever its script text happens to say. That single
# distinction is the whole point of this file.

# proc_running <script-name>   e.g. proc_running run-ev.sh
proc_running() {
  ps -eo command | awk -v want="$1" '
    { n = split($2, p, "/"); if (p[n] == want) hit = 1 }
    END { exit !hit }'
}

# proc_elapsed <script-name> — wall time of the first match, ps etime format.
proc_elapsed() {
  ps -eo etime,command | awk -v want="$1" '
    { n = split($3, p, "/"); if (p[n] == want) { print $1; exit } }'
}

# proc_argv <exe-name> <n> — argv[n] of the first process whose argv[0]
# basename is <exe-name>. Used to read the board a root-ev is solving.
proc_argv() {
  ps -eo command | awk -v want="$1" -v n="$2" '
    { c = split($1, p, "/"); if (p[c] == want) { print $(n + 1); exit } }'
}

# proc_script_argv <script-name> <n> — argv[n] of the first process whose
# argv[1] basename is <script-name>, i.e. an interpreted script. argv[1] is the
# script itself, so n=2 is its first argument. Recovering a detached job's
# arguments this way is the difference between a status tool you can run with
# no arguments and one you have to be told how to call.
proc_script_argv() {
  ps -eo command | awk -v want="$1" -v n="$2" '
    { c = split($2, p, "/"); if (p[c] == want) { print $(n + 1); exit } }'
}
