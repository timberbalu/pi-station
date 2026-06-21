#!/usr/bin/env bash
# provision-pi.sh — one-time Pi setup for MeetPaper Station
# Idempotent: safe to re-run. Does not deploy app code (that's deploy-pi.sh).
# Usage: bash scripts/provision-pi.sh [username@host]
#   Default: pistation@pistation.local

set -euo pipefail
TARGET="${1:-pistation@pistation.local}"
echo "▶ Provisioning $TARGET"

# 1. Verify connectivity
ping -c1 "${TARGET#*@}" > /dev/null 2>&1 || { echo "✗ Cannot reach ${TARGET#*@}"; exit 1; }
ssh "$TARGET" 'echo ok' > /dev/null || { echo "✗ SSH failed"; exit 1; }
echo "  ✓ Connectivity confirmed"

# 2. System packages
ssh "$TARGET" '
  sudo apt-get update -qq
  pkgs=""
  command -v arecord  >/dev/null 2>&1 || pkgs="$pkgs alsa-utils"
  command -v sqlite3  >/dev/null 2>&1 || pkgs="$pkgs sqlite3 libsqlite3-dev"
  dpkg -l git 2>/dev/null | grep -q "^ii" || pkgs="$pkgs git"
  dpkg -l python3-pip 2>/dev/null | grep -q "^ii" || pkgs="$pkgs python3-pip python3-venv"
  [ -n "$pkgs" ] && sudo apt-get install -y $pkgs || true
  echo "  ✓ System packages"
'

# 3. Node.js 22 via fnm (non-destructive)
ssh "$TARGET" '
  if command -v node >/dev/null 2>&1 && [ "$(node --version | cut -d. -f1 | tr -d v)" -ge 22 ]; then
    echo "  ✓ Node $(node --version) already installed"
  else
    curl -fsSL https://fnm.vercel.app/install | bash
    export PATH="$HOME/.local/share/fnm:$PATH"
    eval "$(fnm env)"
    fnm install 22
    fnm default 22
    echo "  ✓ Node 22 installed via fnm"
  fi
'

# 4. Ensure fnm + Node are on PATH in .bashrc for future sessions
ssh "$TARGET" '
  if ! grep -q "fnm env" ~/.bashrc 2>/dev/null; then
    echo "export PATH=\"\$HOME/.local/share/fnm:\$PATH\"" >> ~/.bashrc
    echo "eval \"\$(fnm env)\"" >> ~/.bashrc
    echo "  ✓ fnm added to .bashrc"
  else
    echo "  ✓ fnm already in .bashrc"
  fi
'

# 5. pm2
ssh "$TARGET" '
  export PATH="$HOME/.local/share/fnm:$PATH"
  eval "$(fnm env)" 2>/dev/null || true
  command -v pm2 >/dev/null 2>&1 || npm install -g pm2
  echo "  ✓ pm2 ready"
'

# 6. App directory
ssh "$TARGET" 'mkdir -p ~/pi-station/data/audio && echo "  ✓ App directory ready"'

# 7. Enumerate audio devices
echo ""
echo "  Audio devices on $TARGET:"
ssh "$TARGET" 'arecord -l 2>/dev/null || echo "    (no devices found — is the mic plugged in?)"'
echo ""
echo "  ✓ Provisioning complete"
echo "  Next: bash scripts/deploy-pi.sh $TARGET"
