#!/usr/bin/env bash
# preflight.sh — verify prerequisites before running or deploying.
#
#   bash scripts/preflight.sh         # check the laptop (mock-mode readiness)
#   bash scripts/preflight.sh --pi    # check THIS machine as the Pi (run it ON the Pi)
#
# Exits 0 if all hard requirements pass, 1 otherwise. Soft warnings don't fail.
# Safe to run repeatedly. Does not install anything — it only checks and reports.

set -uo pipefail

PI_MODE=false
[[ "${1:-}" == "--pi" ]] && PI_MODE=true

PASS=0; FAIL=0; WARN=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
warn() { echo "  ! $1"; WARN=$((WARN+1)); }

# minimum major version of Node
need_node_major=22

check_node() {
  if command -v node >/dev/null 2>&1; then
    local v; v="$(node --version | sed 's/v//')"
    local major="${v%%.*}"
    if (( major >= need_node_major )); then ok "Node.js $v (>= $need_node_major)";
    else bad "Node.js $v — need >= $need_node_major. Install: fnm install 22 && fnm use 22"; fi
  else
    bad "Node.js not found. Install Node 22 (fnm / nvm / nodejs.org)"
  fi
}

check_npm() {
  if command -v npm >/dev/null 2>&1; then ok "npm $(npm --version)"; else bad "npm not found"; fi
}

check_port() {
  local port="${PORT:-3456}"
  if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    warn "Port $port is in use — set PORT in .env or free it"
  else
    ok "Port $port is free"
  fi
}

check_env() {
  if [[ -f .env ]]; then ok ".env exists";
  else warn ".env missing — run: cp .env.example .env (mock defaults are fine)"; fi
}

check_toolchain() {
  # better-sqlite3 compiles a native addon
  if command -v cc >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1 || command -v clang >/dev/null 2>&1; then
    ok "C compiler present (better-sqlite3 can build)"
  else
    warn "No C compiler found — better-sqlite3 may fail to install. macOS: xcode-select --install"
  fi
}

check_deps() {
  if [[ -d node_modules ]]; then ok "node_modules present"; else warn "Dependencies not installed — run: npm install"; fi
}

# ── Pi-only checks ────────────────────────────────────────────────────────────
check_arecord() {
  if command -v arecord >/dev/null 2>&1; then ok "arecord present (alsa-utils)";
  else bad "arecord not found — sudo apt install -y alsa-utils"; fi
}

check_mic() {
  if command -v arecord >/dev/null 2>&1; then
    if arecord -l 2>/dev/null | grep -qi "USB Audio"; then
      echo "  ✓ USB mic detected:"
      arecord -l 2>/dev/null | grep -i "USB Audio" | sed 's/^/      /'
      local card; card="$(arecord -l 2>/dev/null | grep -i 'USB Audio' | head -1 | sed -n 's/^card \([0-9]\).*/\1/p')"
      [[ -n "$card" ]] && echo "      → set AUDIO_DEVICE=plughw:${card},0 in .env (and devops/hardware/device-config.md)"
      PASS=$((PASS+1))
    else
      bad "No USB Audio device in 'arecord -l' — is the M-305 plugged in?"
    fi
  else
    bad "Cannot check mic — arecord missing"
  fi
}

check_sqlite_lib() {
  if command -v sqlite3 >/dev/null 2>&1; then ok "sqlite3 present"; else warn "sqlite3 CLI missing — sudo apt install -y sqlite3 libsqlite3-dev"; fi
}

echo "════════════════════════════════════════════════════"
if $PI_MODE; then
  echo "  pi-station preflight — RASPBERRY PI mode"
else
  echo "  pi-station preflight — LAPTOP / mock mode"
fi
echo "════════════════════════════════════════════════════"

echo ""
echo "Runtime:"
check_node
check_npm
check_toolchain

echo ""
echo "Project:"
check_env
check_deps
check_port

if $PI_MODE; then
  echo ""
  echo "Audio (Pi):"
  check_arecord
  check_mic
  check_sqlite_lib
fi

echo ""
echo "────────────────────────────────────────────────────"
echo "  PASS: $PASS    WARN: $WARN    FAIL: $FAIL"
echo "────────────────────────────────────────────────────"
if $PI_MODE; then
  echo "  Next: bash scripts/check-audio.sh   (5s record + playback test)"
  echo "        ./scripts/deploy-pi.sh         (from the laptop, after this passes)"
else
  echo "  Next: npm run dev   →   http://localhost:3456"
fi

[[ $FAIL -eq 0 ]] && exit 0 || exit 1
