#!/usr/bin/env bash
set -euo pipefail

echo "== arecord devices =="
arecord -l || true

echo
echo "== 5 second capture test =="
tmp_file="/tmp/meetpaper-station-check.wav"
arecord -D "${AUDIO_DEVICE:-plughw:1,0}" -f S16_LE -r 16000 -c 1 -d 5 "$tmp_file"
echo "Saved test recording to $tmp_file"
aplay "$tmp_file"
