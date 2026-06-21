# Pi Setup — what actually worked (2026-06-21)

> This reflects what was actually done, not the theory. See `devops/hardware/device-config.md` for confirmed hardware values.

---

## 1. Flash the microSD

Use **Raspberry Pi Imager** on Mac. In Edit Settings before writing:

- Hostname: `pistation` (becomes `pistation.local` on mDNS)
- Username: `pistation`, Password: (set something memorable)
- Wi-Fi: enter the hotspot SSID and password exactly
- Services tab: tick **Enable SSH → password authentication**

Write, eject, insert into Pi, power on. Wait ~2 minutes for first boot (filesystem expansion + reboot).

**Gotcha:** the username and hostname in the imager determine your SSH target. Check `network-config` on the boot partition if SSH fails — mount the SD on Mac and read `/Volumes/bootfs/network-config` to verify the SSID and `/Volumes/bootfs/user-data` for the username.

---

## 2. SSH key setup

Once `ssh pistation@pistation.local` prompts for a password:

```bash
# Generate a dedicated key
ssh-keygen -t ed25519 -f ~/.ssh/pi_station_key -N ""

# Copy key to Pi (use expect if sshpass not available)
expect -c "
spawn ssh -o StrictHostKeyChecking=no pistation@pistation.local \"mkdir -p ~/.ssh && echo '$(cat ~/.ssh/pi_station_key.pub)' >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys\"
expect 'password:'
send 'pistation\r'
expect eof
"

# Add to ~/.ssh/config for convenience
cat >> ~/.ssh/config << 'EOF'
Host pistation.local
  User pistation
  IdentityFile ~/.ssh/pi_station_key
  StrictHostKeyChecking no
EOF
```

Test: `ssh pistation.local "echo ok"`

---

## 3. Provision the Pi

```bash
bash scripts/provision-pi.sh pistation@pistation.local
```

This installs (idempotent, safe to re-run):
- `sqlite3`, `libsqlite3-dev`, `python3-pip`, `python3-venv`
- Node.js 22 via fnm
- pm2

Checks audio devices at the end — plug the M-305 in first.

**Confirmed device string:** `plughw:2,0` (card 2 on this Pi with this mic).

---

## 4. Deploy the app

Build happens on Mac (Pi doesn't have access to `f365/tsconfig.base.json`):

```bash
bash scripts/deploy-pi.sh
```

This builds locally, rsyncs `dist/` + source to the Pi, runs `npm install --omit=dev` on Pi, and starts via pm2.

**Gotcha:** the deploy script uses `pistation@pistation.local` as default. If your username/hostname differs, pass it as an argument.

---

## 5. Configure `.env` on Pi

```bash
scp /tmp/pi-station.env pistation.local:~/pi-station/.env
```

Key values confirmed for this setup:

```bash
AUDIO_SOURCE=arecord
AUDIO_DEVICE=plughw:2,0   # confirmed — card 2 for M-305
STT_PROVIDER=mock          # until ElevenLabs key supplied
```

---

## 6. Install faster-whisper

```bash
ssh pistation.local "
  python3 -m venv ~/pi-station/venv-whisper
  source ~/pi-station/venv-whisper/bin/activate
  pip install faster-whisper --quiet
  python -c \"from faster_whisper import WhisperModel; WhisperModel('base.en', device='cpu', compute_type='int8')\"
  echo done
"
```

Download is ~145MB. GPU warnings (ONNX device detection) are harmless — model runs on CPU.

---

## 7. pm2 auto-start

```bash
ssh pistation.local "
  export PATH=\"\$HOME/.local/share/fnm:\$PATH\"
  eval \"\$(fnm env)\"
  pm2 startup   # copy-paste the sudo command it prints
  pm2 save
"
```

---

## 8. Verify

```bash
# API health
curl http://pistation.local:3456/health
# → {"ok":true,"version":"0.1.0"}

# Full status
curl http://pistation.local:3456/status

# Dashboard
open http://pistation.local:3456

# Audio devices
ssh pistation.local 'arecord -l'

# Test recording (8 seconds)
curl -X POST http://pistation.local:3456/pair -H 'Content-Type: application/json' -d '{"session_code":"482913"}'
curl -X POST http://pistation.local:3456/start
sleep 8
curl -X POST http://pistation.local:3456/stop
ssh pistation.local 'ls -lh ~/pi-station/data/audio/'
# WAV chunk must be present and non-zero
```
