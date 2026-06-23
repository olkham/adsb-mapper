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
# sudo strips the invoking user's PATH, so node may not be visible even though
# it works for the normal user (common with nvm). Try four strategies in order.
NODE_BIN=""
NPM_BIN=""

# 1. System-wide install already on root's PATH
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
  NPM_BIN="$(command -v npm)"
fi

# 2. Source nvm.sh directly from the invoking user's home (most common case)
if [ -z "${NODE_BIN}" ] && [ -n "${SUDO_USER}" ]; then
  USER_HOME="$(eval echo ~"${SUDO_USER}")"
  NVM_SH="${USER_HOME}/.nvm/nvm.sh"
  if [ -s "${NVM_SH}" ]; then
    export NVM_DIR="${USER_HOME}/.nvm"
    # shellcheck disable=SC1090
    \. "${NVM_SH}" --no-use 2>/dev/null || true
    NODE_BIN="$(command -v node 2>/dev/null || true)"
    NPM_BIN="$(command -v npm  2>/dev/null || true)"
  fi
fi

# 3. Scan the nvm versions directory for the highest installed version
if [ -z "${NODE_BIN}" ] && [ -n "${SUDO_USER}" ]; then
  USER_HOME="$(eval echo ~"${SUDO_USER}")"
  NVM_VERS="${USER_HOME}/.nvm/versions/node"
  if [ -d "${NVM_VERS}" ]; then
    NODE_BIN="$(find "${NVM_VERS}" -name "node" -type f 2>/dev/null | sort -V | tail -1)"
    NPM_BIN="$(find "${NVM_VERS}" -name "npm"  -type f 2>/dev/null | sort -V | tail -1)"
  fi
fi

# 4. Login shell fallback (works when node is in .profile / .bash_profile)
if [ -z "${NODE_BIN}" ] && [ -n "${SUDO_USER}" ]; then
  NODE_BIN="$(su - "${SUDO_USER}" -c 'command -v node 2>/dev/null' 2>/dev/null || true)"
  NPM_BIN="$(su - "${SUDO_USER}" -c 'command -v npm  2>/dev/null' 2>/dev/null || true)"
fi

if [ -z "${NODE_BIN}" ]; then
  echo "[ERROR] Node.js not found. Run ./install.sh first (needs Node 18+)."
  exit 1
fi
if [ -z "${NPM_BIN}" ]; then
  echo "[ERROR] npm not found. Ensure Node.js is properly installed."
  exit 1
fi
NODE_BIN_DIR="$(dirname "${NODE_BIN}")"
echo "Using node: ${NODE_BIN}"

# ── Dependencies ─────────────────────────────────────────────────────────────
if [ ! -d "${APP_DIR}/node_modules" ]; then
  echo "Installing npm dependencies..."
  "${NPM_BIN}" install
fi

# Locate vite's JS entry point so we can run it with node directly (more
# reliable in systemd than invoking npm, which needs HOME, a shell, etc.)
VITE_JS="${APP_DIR}/node_modules/vite/bin/vite.js"
if [ ! -f "${VITE_JS}" ]; then
  echo "[ERROR] Vite not found at ${VITE_JS}."
  echo "        Run: npm install"
  exit 1
fi

# ── Determine run-as user ────────────────────────────────────────────────────
# Use the user who called sudo, falling back to the current user.
RUN_USER="${SUDO_USER:-$(logname 2>/dev/null || echo "$USER")}"
if [ -z "$RUN_USER" ] || [ "$RUN_USER" = "root" ]; then
  RUN_USER="nobody"
fiRUN_USER_HOME="$(eval echo ~"${RUN_USER}" 2>/dev/null || echo "/home/${RUN_USER}")"
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
# Call node directly with vite's JS entry – avoids npm's shell-script chain
# which requires HOME, a login shell, and more PATH resolution.
ExecStart=${NODE_BIN} ${VITE_JS}
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}
Environment=PATH=${NODE_BIN_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=HOME=${RUN_USER_HOME}
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
