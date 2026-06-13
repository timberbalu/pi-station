# Pi Hardware Configuration

> Document physical setup details here after first boot. Keep this accurate — it's what any new session (human or LLM) needs to configure the Pi correctly.

---

## Audio device

| Field | Value |
|---|---|
| Mic model | Mini USB Microphone M-305 |
| Connection | USB-A |
| Driver | USB class-compliant (no install needed) |
| Confirmed device string | *(run `arecord -l` on Pi and fill in)* |
| arecord command | `arecord --device=plughw:1,0 --format=S16_LE --rate=16000 --channels=1 --file-type=raw -` |

**To confirm device string on Pi:**
```bash
arecord -l
# Look for: card N: ... [USB Audio Device] ...
# Device string is: plughw:N,0
```

---

## Pi OS setup checklist

- [ ] Pi OS 64-bit installed (Bookworm recommended)
- [ ] SSH enabled
- [ ] Hostname set to `pi-station` (`sudo hostnamectl set-hostname pi-station`)
- [ ] Node.js 22 installed via fnm
- [ ] `alsa-utils` installed (`sudo apt install -y alsa-utils`)
- [ ] `pm2` installed globally (`npm install -g pm2`)
- [ ] `pm2 startup` hook configured
- [ ] `.env` created at `~/pi-station/.env` with real credentials

---

## Network

The Pi should be reachable on the local network at `pi-station.local` via mDNS (avahi-daemon is installed by default on Pi OS). From Mac: `ping pi-station.local` to verify.

If mDNS is not resolving, use the Pi's IP address directly. Find it with: `hostname -I` on the Pi.

---

## Power

- Currently: mains only (no UPS)
- Recommended: USB-C pass-through power bank for battery backup
- Risk without UPS: Pi power loss = recording stops, last WAV chunk may be incomplete

---

## Bill of materials (hackathon kit)

| Item | Notes |
|---|---|
| Raspberry Pi 5 (4GB) | × 2 units (one in box, one bare board) |
| Mini USB Mic M-305 | × 1 unit |
| MicroSD card | × 1 unit (capacity unknown) |
| USB-C cable | For power |
| No USB-C power bank | Single point of failure — to acquire |
