#!/usr/bin/env bash
# Stop the mc-web-client backend server.
set -euo pipefail
cd "$(dirname "$0")"

PID_FILE=".mcwc.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "Not running (no PID file)"
  # best-effort: kill any stray node server/index.js
  pids=$(pgrep -f "node server/index.js" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Killing stray processes: $pids"
    kill $pids 2>/dev/null || true
  fi
  exit 0
fi

PID=$(cat "$PID_FILE")
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  # wait for exit
  for i in $(seq 1 20); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.25
  done
  if kill -0 "$PID" 2>/dev/null; then
    echo "Force killing $PID"
    kill -9 "$PID" 2>/dev/null || true
  fi
  echo "Stopped (PID $PID)"
else
  echo "Process $PID not running"
fi
rm -f "$PID_FILE"
sh