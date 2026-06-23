#!/usr/bin/env bash
# ── ADS-B Mapper – install as a systemd service (Linux) ────────────────────
# Usage:
#   sudo ./install-service.sh              Install / reinstall
#   sudo ./install-service.sh uninstall    Remove the service
set -e
cd "$(dirname "$0")"
APP_DIR="$(pwd)"
SERVICE_NAME="adsb-mapper"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# ── Root check ───────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  echo "[ERROR] Please run as root:  sudo ./install-service.sh"
  exit 1
fi

# ── Uninstall ────────────────────────────────────────────────────────────────
if [ "${1:-}" = "uninstall" ]; then
  echo "Removing ${SERVICE_NAME} service..."
  systemctl stop  "${SERVICE_NAME}.service" 2>/dev/null || true
  systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
  rm -f "${UNIT_FILE}"
  systemctl daemon-reload
  echo "Service removed."
  exit 0
fi

# ── Node / npm check ─────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. Run ./install.sh first (needs Node 18+)."
  exit 1
fi
NPM_BIN="$(command -v npm)"

# ── Dependencies ─────────────────────────────────────────────────────────────
if [ ! -d "${APP_DIR}/node_modules" ]; then
  echo "Installing npm dependencies..."
  npm install
fi

# ── Determine run-as user ────────────────────────────────────────────────────
# Use the user who called sudo, falling back to the current user.
RUN_USER="${SUDO_USER:-$(logname 2>/dev/null || echo "$USER")}"
if [ -z "$RUN_USER" ] || [ "$RUN_USER" = "root" ]; then
  RUN_USER="nobody"
fi

# ── Write systemd unit ───────────────────────────────────────────────────────
echo "Writing ${UNIT_FILE} ..."
cat > "${UNIT_FILE}" <<EOF
[Unit]
Description=ADS-B Mapper – local aircraft tracking map (port 5188)
Documentation=https://github.com/$(basename "${APP_DIR}")
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${NPM_BIN} run dev
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}
# Expose .env variables to the service
EnvironmentFile=-${APP_DIR}/.env

[Install]
WantedBy=multi-user.target
EOF

# ── Enable and start ─────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"
systemctl restart "${SERVICE_NAME}.service"

echo ""
echo "Service '${SERVICE_NAME}' installed and started."
echo ""
echo "  Status  :  systemctl status ${SERVICE_NAME}"
echo "  Logs    :  journalctl -u ${SERVICE_NAME} -f"
echo "  Stop    :  systemctl stop ${SERVICE_NAME}"
echo "  Remove  :  sudo ./install-service.sh uninstall"
