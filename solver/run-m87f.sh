#!/bin/zsh
# The M8.7F 4-subgame batch (2026-08-29): the four DISTINCT (pot, stack)
# postflop games with meaningful traffic, on the stratified flops.txt, into
# the fresh out-root ev-strat/. Picked from `npx tsx solver/reach.ts`
# (2026-08-29 run) after collapsing position-identical subgames per the
# position rule in docs/04 M8.7F:
#
#   l1-sb-bb-p50-s975    51.4% reach (72% of postflop; blind-battle balloon,
#                        but #1 under any correction)
#   l2-sb-bb-p150-s925   16.4% reach (23% of postflop)
#   l1-sb-btn-p60-s975   representative of the p60-s975 group (SB cold-call)
#   l1-hj-co-p65-s975    representative of the p65-s975 group (non-blind call)
#
# The p55-s975 group is the already-published BTN-vs-BB game and is excluded.
#
# Two passes so the two spots carrying 95% of traffic COMPLETE first —
# run-subgames.sh iterates alphabetically and skips existing .ev.json files,
# so the second pass re-walks the priority pair at no cost. A partial batch
# is only useful per COMPLETE subgame (docs/14), so completion order matters.
#
# ALWAYS LAUNCH DETACHED, wrapped in caffeinate -i (a battery sleep has
# already eaten a pass once):
#   nohup caffeinate -i ./solver/run-m87f.sh >> solver/batch-m87f.log 2>&1 & disown
#
# COMPLETION IS A COUNT: ls ev-strat/*/*.ev.json | wc -l  against  4 * 25.
set -eu
cd "$(dirname "$0")"
./run-subgames.sh subgames-m87f-priority ev-strat flops.txt
./run-subgames.sh subgames-m87f ev-strat flops.txt
echo "run-m87f: all four subgames complete $(date -u +%FT%TZ)"
