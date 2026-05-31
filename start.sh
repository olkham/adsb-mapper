#!/usr/bin/env bash
# ── ADS-B Mapper launcher (Linux / macOS) ───────────────────────────────────
# Usage:
#   ./start.sh                       Launch with current .env settings
#   ./start.sh ws://HOST:9001        Set broker URL, then launch
#   ./start.sh ws://HOST:9001 adsb   Set broker URL + topic prefix, launch
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js was not found. Run ./install.sh first (needs Node 18+)."
  exit 1
fi

# Optional: define the MQTT broker straight from the command line.
if [ -n "$1" ]; then
  echo "VITE_MQTT_URL=$1" > .env
  if [ -n "$2" ]; then
    echo "VITE_MQTT_PREFIX=$2" >> .env
  fi
  echo "Wrote .env  (broker: $1)"
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Starting ADS-B Mapper on http://localhost:5188"
echo "Press Ctrl+C to stop."
npm run dev
