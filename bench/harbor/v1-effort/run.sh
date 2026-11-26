#!/bin/bash
# Runs the stage "effort" (bench/PREREGISTRATION.md, change 7) from this checkout, on a machine that only
# runs the benchmark:
#
#   bench/harbor/v1-effort/run.sh [--shutdown <minutes>]
#
# It starts nothing when a file of the checkout differs from its commit, so the stage runs with committed
# code, setups and tasks only. The stage runner (bench/harbor-stage.mjs) waits for Docker, stops at the
# cap and at the account's usage limit, and skips every task a setup already finished, so the same
# command continues a stage that was stopped.
#
# It writes, in the folder above the stage's records ("out" in stage.json):
#   run.log                one line per step, with the time in UTC
#   stage-runner.log       what the stage runner printed
#   report-effort.md       the report of bench/harbor.mjs
#   analysis-effort.md     the registered analysis (analyze.mjs), with analysis-effort.json
#   DONE                   written last
#
# --shutdown <minutes> turns the machine off that many minutes after the end, whatever the end was.
# Nobody reads the report or the analysis before the stage has ended: while it runs, only the status
# file (status-effort.md beside the records) is looked at, which holds spend and health and no comparison.
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
STAGE="$HERE/stage.json"
SHUTDOWN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --shutdown) SHUTDOWN="$2"; shift 2 ;;
    *) echo "usage: bench/harbor/v1-effort/run.sh [--shutdown <minutes>]" >&2; exit 1 ;;
  esac
done

cd "$ROOT" || exit 1
changed="$(git status --porcelain)"
if [ -n "$changed" ]; then
  echo "The checkout differs from its commit, so the stage does not start:" >&2
  echo "$changed" >&2
  exit 1
fi
OUT="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).out)' "$STAGE")" || exit 1
JOBS="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).jobs)' "$STAGE")" || exit 1
BASE="$(dirname "$OUT")"
mkdir -p "$BASE" || exit 1
LOG="$BASE/run.log"
log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

log "stage effort starts; widal-code at $(git rev-parse HEAD); stage file $(sha256sum "$STAGE" | cut -c1-16), setups $(sha256sum "$HERE/setups.json" | cut -c1-16), analysis $(sha256sum "$HERE/analyze.mjs" | cut -c1-16)"
rm -f "$BASE/DONE"
node bench/harbor-stage.mjs --config "$STAGE" >> "$BASE/stage-runner.log" 2>&1
log "the stage runner ended with code $?: $(tail -n 1 "$BASE/stage-runner.log")"
node bench/harbor.mjs report --out "$OUT" --stage effort --baseline effort-base > "$BASE/report-effort.md" 2>> "$LOG"
log "the report ended with code $?"
node bench/harbor/v1-effort/analyze.mjs --records "$OUT" --jobs "$JOBS" --json "$BASE/analysis-effort.json" > "$BASE/analysis-effort.md" 2>> "$LOG"
log "the analysis ended with code $?"
touch "$BASE/DONE"
if [ -n "$SHUTDOWN" ]; then
  log "the machine turns off in $SHUTDOWN minutes"
  sudo shutdown -h "+$SHUTDOWN" >> "$LOG" 2>&1
fi
