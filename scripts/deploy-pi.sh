#!/usr/bin/env bash
# deploy-pi.sh — sync pi-station to the Raspberry Pi
#
# Usage: ./scripts/deploy-pi.sh [pi-hostname-or-ip]
# Default host: pi-station.local  (mDNS — works on same LAN)
#
# Prerequisites on the Pi:
#   sudo apt install -y nodejs npm alsa-utils
#   npm install -g tsx pm2

set -euo pipefail

PI_HOST="${1:-pistation.local}"
PI_USER="pistation"
PI_DIR="/home/pistation/pi-station"

echo "▶ Deploying to ${PI_USER}@${PI_HOST}:${PI_DIR}"

# 1. Build locally first (TypeScript compile on Mac, not Pi)
echo "  Building locally..."
npm run build

# 2. Sync source + compiled dist (exclude node_modules and local runtime files)
rsync -avz --delete \
  --exclude 'node_modules/' \
  --exclude '.env' \
  --exclude 'data/' \
  --exclude '*.db' \
  --exclude '*.log' \
  . "${PI_USER}@${PI_HOST}:${PI_DIR}"

# 3. Install production dependencies on Pi (no build step needed)
ssh "${PI_USER}@${PI_HOST}" "
  export PATH=\"\$HOME/.local/share/fnm:\$PATH\"
  eval \"\$(fnm env)\" 2>/dev/null || true
  cd ${PI_DIR} && npm install --omit=dev
"

# 4. Restart via pm2
ssh "${PI_USER}@${PI_HOST}" "
  export PATH=\"\$HOME/.local/share/fnm:\$PATH\"
  eval \"\$(fnm env)\" 2>/dev/null || true
  cd ${PI_DIR} && pm2 restart pi-station 2>/dev/null || pm2 start apps/meet-station/dist/index.js --name pi-station
"

echo "✓ Deployed and restarted on ${PI_HOST}"
echo ""
echo "  Status page: http://${PI_HOST}:3456/status"
echo "  Logs:        ssh ${PI_USER}@${PI_HOST} 'pm2 logs pi-station'"
