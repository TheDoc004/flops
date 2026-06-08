#!/bin/bash
# Start NutriLog (API + frontend). Run from any directory:
#   bash /Users/diegoramirez/Documents/NutriLog/nutrition-tracker/start-app.sh

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Starting API on http://localhost:3001 ..."
cd "$ROOT/server"
node index.js &
API_PID=$!

cleanup() {
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 2
echo "Starting app UI on http://localhost:5173 ..."
cd "$ROOT/client"
npm run dev
