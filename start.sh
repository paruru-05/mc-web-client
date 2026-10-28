#!/usr/bin/env bash
# Start the mc-web-client backend server in the background.
set -euo pipefail
cd "$(dirname "$0")"

PID_FILE=".mcwc.pid"
LOG_FILE="/tmp/mcwc-server.log"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Already running (PID $(cat "$PID_FILE"))"
  exit 0
fi

# Build frontend if dist is missing
if [ ! -d "web/dist" ]; then
  echo "web/dist missing — building..."
  (cd web && npm run build)
fi

nohup node server/index.js > "$LOG_FILE" 2>&1 &
SRV=$!
echo $SRV > "$PID_FILE"
disown $SRV 2>/dev/null || true
sleep 2

if kill -0 "$SRV" 2>/dev/null; then
  echo "Started (PID $SRV) — http://localhost:8091"
  echo "Logs: $LOG_FILE"
else
  echo "Failed to start. See $LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi
sh