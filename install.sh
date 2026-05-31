#!/usr/bin/env bash
# ── ADS-B Mapper installer (Linux / macOS) ──────────────────────────────────
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js was not found."
  echo "Install Node.js 18 or newer from https://nodejs.org/ (or your package manager) and try again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm was not found. Reinstall Node.js from https://nodejs.org/"
  exit 1
fi

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "Created .env from .env.example - edit it to point at your MQTT broker."
fi

echo "Installing dependencies..."
npm install

echo
echo "Done. Launch the app with ./start.sh"
