# Pi Hardware Configuration

> Document physical setup details here after first boot. Keep this accurate — it's what any new session (human or LLM) needs to configure the Pi correctly.

---

## Audio device

| Field | Value |
|---|---|
| Mic model | Mini USB Microphone M-305 |
| Connection | USB-A (any port) |
| Driver | USB class-compliant (no install needed) |
| **Confirmed device string** | **`plughw:2,0`** |
| arecord command | `arecord --device=plughw:2,0 --format=S16_LE --rate=16000 --channels=1 --file-type=raw -` |
| Confirmed | 2026-06-21 — `arecord -l` shows `card 2: Device [USB PnP Sound Device], device 0: USB Audio [USB Audio]` |

**Note:** card index may change if USB devices are re-plugged in a different order. Always verify with `arecord -l` if audio capture fails.

---

## Pi OS

| Field | Value |
|---|---|
| OS | Debian GNU/Linux 13 (trixie) — Raspberry Pi OS 64-bit |
| Kernel | 6.18.34+rpt-rpi-2712 |
| Hostname | `pistation` (mDNS: `pistation.local`) |
| Username | `pistation` |
| SSH | Key-based auth, key at `~/.ssh/pi_station_key` on Mac |

---

## Node.js & runtime

| Field | Value |
|---|---|
| Node version | v22.23.0 (installed via fnm) |
| fnm path | `~/.local/share/fnm` |
| pm2 | Installed globally, auto-start via systemd (`pm2-pistation.service`) |
| App dir | `/home/pistation/pi-station/` |
| Data dir | `/home/pistation/pi-station/data/` |

---

## faster-whisper

| Field | Value |
|---|---|
| venv | `/home/pistation/pi-station/venv-whisper` |
| Model | `base.en` (~145MB, downloaded to `~/.cache/huggingface`) |
| Script | `scripts/transcribe.py` |
| Confirmed | 2026-06-21 — returns `{"segments":[], "language":"en"}` on silence |

---

## Network

| Field | Value |
|---|---|
| Hostname | `pistation.local` |
| Current network | iPhone personal hotspot (SSID: `2703369`) |
| SSH config | `~/.ssh/config` on Mac has `Host pistation.local` entry |

---

## Pi OS setup checklist (confirmed 2026-06-21)

- [x] Pi OS 64-bit (Debian trixie) installed via Raspberry Pi Imager
- [x] SSH enabled (cloud-init, key-based auth set up)
- [x] Hostname: `pistation`
- [x] Node.js 22 installed via fnm
- [x] `sqlite3`, `libsqlite3-dev`, `python3-venv` installed
- [x] `pm2` installed globally, startup hook configured (`pm2-pistation.service`)
- [x] `.env` created at `/home/pistation/pi-station/.env`
- [x] faster-whisper installed in `venv-whisper`, `base.en` model downloaded
- [x] App deployed, running, WAV chunks writing (`chunk-000001.wav` = 251KB for 8s session)

---

## Power

- Currently: mains only (no UPS)
- Recommended: USB-C pass-through power bank for battery backup
- Risk without UPS: Pi power loss = recording stops, last WAV chunk may be incomplete

---

## Bill of materials

| Item | Notes |
|---|---|
| Raspberry Pi 5 (4GB) | × 2 units |
| Mini USB Mic M-305 | × 1 unit — USB 2.0, class-compliant, 100Hz–8kHz |
| MicroSD card | × 1 unit |
| USB-C cable | For power |
| No USB-C power bank | Single point of failure — to acquire |
