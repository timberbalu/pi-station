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

PI_HOST="${1:-pi-station.local}"
PI_USER="pi"
PI_DIR="/home/pi/pi-station"

echo "▶ Deploying to ${PI_USER}@${PI_HOST}:${PI_DIR}"

# 1. Sync source files (exclude node_modules, dist, local runtime files)
rsync -avz --delete \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude '.env' \
  --exclude 'buffer/' \
  --exclude '*.db' \
  --exclude '*.log' \
  . "${PI_USER}@${PI_HOST}:${PI_DIR}"

# 2. Install dependencies on the Pi
ssh "${PI_USER}@${PI_HOST}" "cd ${PI_DIR} && npm install --production"

# 3. Restart via pm2 (keeps the process alive across terminal sessions)
ssh "${PI_USER}@${PI_HOST}" "cd ${PI_DIR} && pm2 restart pi-station 2>/dev/null || pm2 start dist/index.js --name pi-station"

echo "✓ Deployed and restarted on ${PI_HOST}"
echo ""
echo "  Status page: http://${PI_HOST}:3456/status"
echo "  Logs:        ssh ${PI_USER}@${PI_HOST} 'pm2 logs pi-station'"
