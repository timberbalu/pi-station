#!/usr/bin/env bash
# migrate-data-dir.sh — move session data from inside-app to outside-app directory.
# Safe to run multiple times (idempotent).
#
# Before J6: data lived at /home/pistation/pi-station/data/ (inside the app dir)
# After  J6: data lives at /home/pistation/data/meet-station/ (outside, survives deploys)
#
# Usage: bash scripts/migrate-data-dir.sh [user@host]
#   Default: pistation@pistation.local

set -euo pipefail

SSH_TARGET="${1:-pistation@pistation.local}"

echo "→ Migrating data directory on ${SSH_TARGET}"

ssh "$SSH_TARGET" '
  set -euo pipefail

  # Create new directory structure
  mkdir -p /home/pistation/data/meet-station/sessions
  mkdir -p /home/pistation/data/meet-station/sqlite
  mkdir -p /home/pistation/data/meet-station/reports
  mkdir -p /home/pistation/data/meet-station/logs
  echo "  ✓ New directories created: /home/pistation/data/meet-station/"

  # Move SQLite if present in old location and not yet migrated
  OLD_SQLITE=/home/pistation/pi-station/data/station.sqlite
  NEW_SQLITE=/home/pistation/data/meet-station/sqlite/station.sqlite

  if [ -f "$OLD_SQLITE" ] && [ ! -f "$NEW_SQLITE" ]; then
    cp "$OLD_SQLITE" "$NEW_SQLITE"
    echo "  ✓ SQLite migrated: $OLD_SQLITE → $NEW_SQLITE"
  elif [ -f "$NEW_SQLITE" ]; then
    echo "  ✓ SQLite already at new location — skipped"
  else
    echo "  ℹ No existing SQLite to migrate"
  fi

  # Move existing audio sessions if present (old layout: data/audio/<session_id>/)
  OLD_AUDIO=/home/pistation/pi-station/data/audio
  NEW_SESSIONS=/home/pistation/data/meet-station/sessions

  if [ -d "$OLD_AUDIO" ] && [ "$(ls -A "$OLD_AUDIO" 2>/dev/null)" ]; then
    cp -rn "$OLD_AUDIO/." "$NEW_SESSIONS/"
    echo "  ✓ Audio sessions migrated: $OLD_AUDIO → $NEW_SESSIONS"
  else
    echo "  ℹ No existing audio sessions to migrate"
  fi

  echo ""
  echo "  ✓ Migration complete."
  echo "  New location: /home/pistation/data/meet-station/"
  echo ""
  echo "  Next: update Pi .env to:"
  echo "    DATA_DIR=/home/pistation/data/meet-station"
  echo "    SQLITE_PATH=/home/pistation/data/meet-station/sqlite/station.sqlite"
  echo "    AUDIO_DIR=/home/pistation/data/meet-station/sessions"
  echo "    VIDEO_DIR=/home/pistation/data/meet-station/sessions"
  echo "    FACES_DIR=/home/pistation/data/meet-station/sessions"
  echo "    REPORTS_DIR=/home/pistation/data/meet-station/reports"
  echo "  Then: pm2 restart pi-station"
'
