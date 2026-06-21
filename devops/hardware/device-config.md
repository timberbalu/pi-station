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

## Camera (J6 — confirmed 2026-06-21)

| Field | Value |
|---|---|
| Camera module | Raspberry Pi Camera Module 3 |
| Sensor | Sony IMX708 |
| Connection | CSI ribbon (contacts facing USB ports) |
| Confirmed resolution | 2304×1296 @ 30.01fps (`rpicam-hello` output) |
| rpicam-vid command | `rpicam-vid --width 1280 --height 720 --framerate 30 --bitrate 2000000 --codec h264 --segment 30000 --output chunk-%04d.mp4 --nopreview -t 0` |
| VIDEO_SOURCE env var | `libcamera` |

---

## AI HAT+ (J6 — confirmed 2026-06-21)

| Field | Value |
|---|---|
| Hardware | Raspberry Pi AI HAT+ |
| NPU | Hailo PiSP BCM2712_C0 |
| Interface | PCIe Gen 3 (Pi 5 M.2 connector) |
| Detection | `libcamera` output confirms pipeline active (`[1:23:45.678901234] [...]`) |
| Install command | `sudo apt install hailo-all && sudo reboot` |
| Verify | `hailortcli fw-control identify` |
| Face detection pipeline | `/usr/share/rpi-camera-assets/hailo_yolov8_inference.json` |
| FACE_DETECTION env var | `hailo` |

---

## Pan/tilt servo (J6 — wiring spec)

| Field | Value |
|---|---|
| Servo driver | PCA9685 (16-channel, 12-bit PWM, I2C address 0x40) |
| I2C wiring | SDA → GPIO2 (Pin 3), SCL → GPIO3 (Pin 5), GND → GND, VCC → 3.3V |
| Pan servo | MG996R on PCA9685 channel 0 (high-torque, needed for camera weight) |
| Tilt servo | SG90 on PCA9685 channel 1 |
| Servo power | External 5V supply → PCA9685 V+ and GND (NEVER from Pi GPIO 3.3V) |
| I2C verify | `i2cdetect -y 1` — should show device at 0x40 |
| PAN_TILT env var | `pca9685` |
| Pan range | 30°–150° (neutral 90°) |
| Tilt range | 60°–120° (neutral 90°) |

---

## Data directory (J6 — new layout, survives deploys)

| Path | Purpose |
|---|---|
| `/home/pistation/data/meet-station/sessions/{id}/audio/` | WAV chunks |
| `/home/pistation/data/meet-station/sessions/{id}/video/` | MP4 chunks |
| `/home/pistation/data/meet-station/sessions/{id}/transcripts/` | Whisper output |
| `/home/pistation/data/meet-station/sessions/{id}/faces/` | AI HAT+ face detection JSON |
| `/home/pistation/data/meet-station/sqlite/station.sqlite` | SQLite database |
| `/home/pistation/data/meet-station/reports/` | Session reports |

Run `bash scripts/migrate-data-dir.sh` to migrate from the old inside-app location.

---

## Bill of materials

| Item | Notes |
|---|---|
| Raspberry Pi 5 (4GB) | × 2 units |
| Mini USB Mic M-305 | × 1 unit — USB 2.0, class-compliant, 100Hz–8kHz |
| Camera Module 3 (imx708) | × 1 unit — 12MP Sony IMX708, wide-angle |
| AI HAT+ (Hailo 26 TOPS) | × 1 unit — PCIe Gen 3 NPU, face detection at 30fps |
| PCA9685 servo driver | × 1 unit — I2C 16-channel PWM |
| MG996R servo | × 1 unit — pan axis (high-torque) |
| SG90 servo | × 1 unit — tilt axis |
| MicroSD card | × 1 unit |
| USB-C cable | For power |
| No USB-C power bank | Single point of failure — to acquire |
