#!/usr/bin/env bash
# ── ADS-B Mapper installer (Linux / macOS) ──────────────────────────────────
set -e
cd "$(dirname "$0")"

install_node() {
  echo "Node.js not found. Attempting automatic installation..."
  if command -v curl >/dev/null 2>&1; then
    DOWNLOAD=curl
  elif command -v wget >/dev/null 2>&1; then
    DOWNLOAD=wget
  else
    echo "[ERROR] Neither curl nor wget is available. Install Node.js 18+ manually from https://nodejs.org/"
    exit 1
  fi

  # Use nvm for a non-root, cross-platform install
  NVM_DIR="${HOME}/.nvm"
  if [ ! -f "${NVM_DIR}/nvm.sh" ]; then
    echo "Installing nvm..."
    if [ "$DOWNLOAD" = "curl" ]; then
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    else
      wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    fi
  fi

  # Load nvm into this shell session
  # shellcheck source=/dev/null
  . "${NVM_DIR}/nvm.sh"

  echo "Installing Node.js LTS via nvm..."
  nvm install --lts
  nvm use --lts
}

if ! command -v node >/dev/null 2>&1; then
  install_node
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm still not found after Node.js install. Please install Node.js 18+ manually from https://nodejs.org/"
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
