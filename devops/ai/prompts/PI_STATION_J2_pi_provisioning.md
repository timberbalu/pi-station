# PI_STATION_J2 — Establish Pi connectivity and provision the device

> **Full-authorisation mode.** `.claude/settings.json` pre-authorises all operations needed here: `ssh pi@*`, `scp`, `rsync`, `ping`, `pm2`, `bash scripts/*`, `curl`, `npm`. Do not pause for approval on any of these.
>
> **Read first:** `devops/ai/START_HERE.md`, `devops/ai/diary.md`, `devops/ai/memory.md`, `CLAUDE.md`, `devops/hardware/PREREQUISITES.md`.
>
> **Recommended model:** Claude Opus or GPT-5 Codex.
>
> **Strategic note (from START_HERE):** this hackathon is a growth hacking technique, not a competition. Build for the product, not the prize. Every decision here should be one you'd make shipping to real event organisers.

---

## What this job is

Get MeetPaper Station running on the actual Raspberry Pi 5 — reachable over LAN, auto-starting on boot, confirmed capturing real audio from the M-305 USB mic, serving the dashboard at `http://<host>:3456`. This is **infrastructure** — the foundation everything else sits on.

This job has a **human-physical half** and an **LLM-automatable half**. The LLM cannot power a Pi, plug in a mic, or join a Wi-Fi network. The split is explicit below.

---

## Part A — Human prerequisites (you must do these before saying continue)

The LLM will wait for you to confirm these are done before proceeding to Part B.

- [ ] **Pi 5 powered on** — USB-C mains power.
- [ ] **Pi on the same network as your laptop** — wired Ethernet is most reliable; a personal hotspot you control is second best. Venue/shared Wi-Fi is the least reliable option.
- [ ] **Pi OS 64-bit (Bookworm) flashed and booted.** Use Raspberry Pi Imager on your laptop. In its advanced settings: set a hostname (suggest `pi-station`), set username/password, configure Wi-Fi if using wireless, **enable SSH**. Optionally pre-load your SSH public key.
- [ ] **SSH reachable.** From your laptop: `ssh <username>@pi-station.local 'echo ok'` (or use the Pi's IP from `hostname -I`). It must return `ok`.
- [ ] **SSH key auth set up** — run `ssh-copy-id <username>@pi-station.local` once so all subsequent SSH/rsync steps run unattended without password prompts. This is required for the LLM's automated steps to work.
- [ ] **M-305 USB mic physically plugged into the Pi.**

When all are done: tell the LLM the Pi's address (hostname or IP) and username, and say "continue".

---

## Part B — LLM: write and run the provisioning script

### B1. Write `scripts/provision-pi.sh`

Create this script. It must be **idempotent** — safe to run multiple times, each step checks before acting.

```bash
#!/usr/bin/env bash
# provision-pi.sh — one-time Pi setup for MeetPaper Station
# Idempotent: safe to re-run. Does not deploy app code (that's deploy-pi.sh).
# Usage: bash scripts/provision-pi.sh [username@host]
#   Default: pi@pi-station.local

set -euo pipefail
TARGET="${1:-pi@pi-station.local}"
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
  dpkg -l git >/dev/null 2>&1        || pkgs="$pkgs git"
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

# 4. pm2
ssh "$TARGET" '
  export PATH="$HOME/.local/share/fnm:$PATH"
  eval "$(fnm env)" 2>/dev/null || true
  command -v pm2 >/dev/null 2>&1 || npm install -g pm2
  echo "  ✓ pm2 ready"
'

# 5. App directory
ssh "$TARGET" 'mkdir -p ~/pi-station && echo "  ✓ App directory ready"'

# 6. Enumerate audio devices
echo ""
echo "  Audio devices on $TARGET:"
ssh "$TARGET" 'arecord -l 2>/dev/null || echo "    (no devices found — is the mic plugged in?)"'
echo ""
echo "  ✓ Provisioning complete"
echo "  Next: bash scripts/deploy-pi.sh $TARGET"
```

Make it executable: `chmod +x scripts/provision-pi.sh`.

### B2. Run it

```bash
bash scripts/provision-pi.sh <username>@pi-station.local
```

If a step fails, report the exact error. Do not paper over failures.

---

## Part C — LLM: create `.env` and deploy

### C1. Add faster-whisper to config

The current `config.ts` has `STT_PROVIDER: z.enum(['mock', 'elevenlabs'])`. Add `'faster-whisper'` as a third option:

```typescript
STT_PROVIDER: z.enum(['mock', 'elevenlabs', 'faster-whisper']).default('mock'),
```

Add corresponding env vars to `.env.example`:
```bash
# faster-whisper (local batch STT — better quality than Vosk, runs offline)
FASTER_WHISPER_MODEL=base.en   # base.en (~145MB) or small.en (~466MB)
FASTER_WHISPER_SCRIPT=scripts/transcribe.py
```

This is a non-breaking change — mock and elevenlabs still work. faster-whisper runs as a Python subprocess called post-session; it is not a live streaming provider.

### C2. Create `scripts/transcribe.py`

The Node.js SyncService will call this script after session stop to batch-transcribe WAV chunks:

```python
#!/usr/bin/env python3
"""
transcribe.py — batch transcribe a WAV file using faster-whisper
Called by the Node.js SyncService after session stop.

Usage:
  python scripts/transcribe.py <wav_file> [--model base.en] [--output json]

Outputs JSON to stdout:
  { "segments": [{ "start": 0.0, "end": 2.5, "text": "...", "words": [...] }] }
"""

import sys
import json
import argparse
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('wav_file', help='Path to WAV file')
    parser.add_argument('--model', default='base.en', help='Whisper model name')
    parser.add_argument('--language', default='en', help='Language code')
    args = parser.parse_args()

    wav_path = Path(args.wav_file)
    if not wav_path.exists():
        print(json.dumps({'error': f'File not found: {wav_path}'}))
        sys.exit(1)

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({'error': 'faster-whisper not installed. Run: pip install faster-whisper'}))
        sys.exit(1)

    model = WhisperModel(args.model, device='cpu', compute_type='int8')
    segments_out = []

    segments, info = model.transcribe(
        str(wav_path),
        language=args.language,
        word_timestamps=True,
        vad_filter=True,          # skip silence
        vad_parameters=dict(min_silence_duration_ms=500)
    )

    for seg in segments:
        words = [{'word': w.word, 'start': w.start, 'end': w.end} for w in (seg.words or [])]
        segments_out.append({
            'start': seg.start,
            'end': seg.end,
            'text': seg.text.strip(),
            'words': words,
        })

    print(json.dumps({'segments': segments_out, 'language': info.language}))

if __name__ == '__main__':
    main()
```

Make executable: `chmod +x scripts/transcribe.py`.

### C3. Create the Pi's `.env`

Construct a `.env` for the Pi. Do **not** put real secrets in the repo. Write it and `scp` it:

```bash
# Construct Pi .env (adjust values as confirmed during provision)
cat > /tmp/pi-station.env << 'EOF'
NODE_ENV=production
PORT=3456
HOST=0.0.0.0
STATION_ID=MPS-001
STATION_NAME=MeetPaper Station 001
DATA_DIR=/home/pi/pi-station/data
SQLITE_PATH=/home/pi/pi-station/data/station.sqlite
AUDIO_DIR=/home/pi/pi-station/data/audio

# Set by provisioning — replace plughw:1,0 with confirmed device from arecord -l
AUDIO_SOURCE=arecord
AUDIO_DEVICE=plughw:1,0
AUDIO_SAMPLE_RATE=16000
AUDIO_CHANNELS=1
AUDIO_CHUNK_SECONDS=30

# STT: use mock until ElevenLabs key is supplied
STT_PROVIDER=mock
ELEVENLABS_API_KEY=

# Relay: use mock ingest until apm receiver is built (J4)
VOICE_INGEST_URL=http://localhost:3456/mock/ingest
VOICE_INGEST_TOKEN=dev-token

RELAY_FLUSH_INTERVAL_MS=2000
RELAY_MAX_ATTEMPTS=50
RELAY_INITIAL_BACKOFF_MS=1000
RELAY_MAX_BACKOFF_MS=30000

ENABLE_MOCK_INGEST=true
MOCK_INGEST_AVAILABLE=true

PAIRING_MODE=local
ENABLE_GPIO=false
FASTER_WHISPER_MODEL=base.en
FASTER_WHISPER_SCRIPT=/home/pi/pi-station/scripts/transcribe.py
EOF

scp /tmp/pi-station.env <username>@pi-station.local:~/pi-station/.env
rm /tmp/pi-station.env
echo "✓ .env deployed (no secrets in repo)"
```

### C4. Build and deploy

```bash
npm run build                              # compile TypeScript to dist/
bash scripts/deploy-pi.sh <username>@pi-station.local
```

The existing `deploy-pi.sh` rsync's to the Pi and restarts via pm2. Verify it includes `scripts/transcribe.py` and `scripts/check-audio.sh` in the rsync — if not, update the excludes list.

### C5. Install faster-whisper on the Pi

```bash
ssh <username>@pi-station.local << 'EOF'
  python3 -m venv ~/pi-station/venv-whisper
  source ~/pi-station/venv-whisper/bin/activate
  pip install faster-whisper
  # Download model now while we have internet (145MB for base.en)
  python -c "from faster_whisper import WhisperModel; WhisperModel('base.en', device='cpu', compute_type='int8')"
  echo "✓ faster-whisper ready with base.en model"
EOF
```

Keep this in a dedicated venv (`venv-whisper`) separate from any other Python environment.

---

## Part D — Verify

Run each check. Report results. Do not skip.

### D1. API responds
```bash
curl http://pi-station.local:3456/status
# Must return: { "state": "IDLE", ... }

curl http://pi-station.local:3456/health
# Must return: { "ok": true, "version": "0.1.0" }
```

### D2. Dashboard loads
Open `http://pi-station.local:3456` in your laptop browser. The MeetPaper Station dashboard must load. Confirm with the human.

### D3. Audio device confirmed
```bash
ssh <username>@pi-station.local 'arecord -l'
```
Identify the M-305 card number. It will appear as something like:
```
card 1: M305 [USB Audio Device], device 0: USB Audio [USB Audio]
```
The device string is `plughw:1,0` (replace `1` with the actual card number).

Update two places:
1. `devops/hardware/device-config.md` — record the confirmed string
2. The Pi's `.env` — update `AUDIO_DEVICE=plughw:<N>,0` via ssh

### D4. Real audio capture test
```bash
bash scripts/check-audio.sh <username>@pi-station.local
```
This records 5 seconds and plays it back. If playback is silent or fails, the device string is wrong — re-check `arecord -l`.

### D5. Real recording session
```bash
curl -X POST http://pi-station.local:3456/start
sleep 10
curl -X POST http://pi-station.local:3456/stop
ssh <username>@pi-station.local 'ls -lh ~/pi-station/data/audio/'
```
WAV chunk files must be present and non-zero in size.

### D6. faster-whisper batch transcription
```bash
# Get the path of the first WAV chunk
CHUNK=$(ssh <username>@pi-station.local 'ls ~/pi-station/data/audio/*/*.wav 2>/dev/null | head -1')
ssh <username>@pi-station.local "
  source ~/pi-station/venv-whisper/bin/activate
  python ~/pi-station/scripts/transcribe.py '$CHUNK' --model base.en
"
# Must return JSON with segments. If spoken during the recording, text should be present.
```

### D7. Auto-start on reboot
```bash
ssh <username>@pi-station.local 'pm2 startup'
# pm2 prints a sudo command — run that command on the Pi
ssh <username>@pi-station.local 'pm2 save'
ssh <username>@pi-station.local 'sudo reboot'
sleep 30
curl http://pi-station.local:3456/health
# Must return { "ok": true } — proves service survived reboot
```

---

## Part E — Update docs

Update `devops/hardware/device-config.md` with:
- Confirmed `AUDIO_DEVICE` string
- Pi OS version confirmed
- Node version on Pi
- faster-whisper model confirmed
- Anything that differed from the plan

Update `docs/PI_SETUP.md` with the steps that actually worked — not the theory, the reality. Future sessions read this.

---

## Close the loop (required)

1. `npm run typecheck` clean on the laptop (config.ts change must compile).
2. Diary entry in `devops/ai/diary.md`: date, what worked, what the real device string was, any surprises.
3. Append run report to `devops/ai/project.md`.
4. Set `devops/ai/job.md` STATUS to DONE. Next job: J3 (component platform).
5. `git add -A && git commit -m "[pi-station] J2: Pi provisioned, real audio confirmed, faster-whisper ready"`.
6. `git push origin main`.

---

## Done criteria

- [ ] `scripts/provision-pi.sh` exists, idempotent, ran clean
- [ ] `scripts/transcribe.py` exists, runs on the Pi, returns JSON
- [ ] `config.ts` accepts `STT_PROVIDER=faster-whisper`
- [ ] Pi reachable at `http://pi-station.local:3456`
- [ ] Dashboard loads in laptop browser over LAN
- [ ] Real M-305 WAV chunks written after a start/stop cycle
- [ ] faster-whisper transcribes a real WAV chunk to JSON
- [ ] Confirmed `AUDIO_DEVICE` in `devops/hardware/device-config.md`
- [ ] Service auto-starts after reboot
- [ ] `docs/PI_SETUP.md` reflects what actually worked
- [ ] Diary + project + job updated, committed, pushed
