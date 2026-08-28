#!/usr/bin/env bash
# ── ADS-B Mapper – restart the running service (Linux) ──────────────────────
# Use this after editing .env so Vite picks up the new values.
# Usage:
#   sudo ./restart.sh
set -e
cd "$(dirname "$0")"
SERVICE_NAME="adsb-mapper"

if ! systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1 \
   || ! systemctl status "${SERVICE_NAME}.service" >/dev/null 2>&1; then
  echo "[INFO] The ${SERVICE_NAME} service is not installed."
  echo "       If you run the app with ./start.sh, just stop it (Ctrl+C) and start it again."
  exit 0
fi

if [ "$EUID" -ne 0 ]; then
  echo "[ERROR] Please run as root:  sudo ./restart.sh"
  exit 1
fi

echo "Restarting ${SERVICE_NAME} service..."
systemctl restart "${SERVICE_NAME}.service"
systemctl --no-pager status "${SERVICE_NAME}.service" | head -n 5
echo "Done."
