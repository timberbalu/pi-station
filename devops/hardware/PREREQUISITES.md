# PREREQUISITES — what must be true before each phase

> Read this before running or deploying. It separates **what the LLM can verify and fix itself** from **what only a human can do** (plug in hardware, join a network). Two phases with very different needs: **mock mode** (laptop, zero hardware) and **real mode** (the Pi).
>
> Quick machine check: `bash scripts/preflight.sh` (laptop) or `bash scripts/preflight.sh --pi` (after SSH to the Pi).

---

## Phase A — Mock mode (laptop demo). The default. Needs almost nothing.

This is what runs at the hackathon if the Pi misbehaves. **No microphone, no Pi, no ElevenLabs key, no network to the cloud.**

### LLM can verify these itself (run `scripts/preflight.sh`)
- [ ] **Node.js ≥ 22** — `node --version`. If missing/older, stop and tell the human to install Node 22 (don't auto-install system packages).
- [ ] **npm present** — `npm --version`.
- [ ] **Port 3456 free** — nothing else listening. If taken, set `PORT` in `.env`.
- [ ] **`.env` exists** — if not, `cp .env.example .env` (safe; mock defaults work as-is).
- [ ] **Dependencies installed** — `npm install` completes (note: `better-sqlite3` compiles a native module; needs a C toolchain — see below).

### Human may need to do (only if preflight fails)
- [ ] **Install Node 22** if the laptop doesn't have it (`fnm install 22 && fnm use 22`, or nvm, or the installer from nodejs.org).
- [ ] **C toolchain for `better-sqlite3`** — on macOS this means Xcode Command Line Tools: `xcode-select --install`. Usually already present. Only an issue on a fresh machine.

### Done when
`npm run dev` starts, `http://localhost:3456` shows the dashboard, you can Pair → Start → see mock transcript → Simulate network drop → Reconnect. **No hardware involved.**

---

## Phase B — Real mode (the Raspberry Pi). Needed only for the live-hardware demo.

Most of these are **physical actions only you can do** — the LLM cannot plug in a mic or join a Wi-Fi network. Do these first, then the LLM can verify and deploy.

### Human must do (physical / network — the LLM cannot)
- [ ] **Pi powered on** — Pi 5 connected to mains via USB-C. (No UPS battery on hand; mains only.)
- [ ] **Pi on the same network as the laptop** — same Wi-Fi or Ethernet. For the hackathon, ideally a wired connection or a phone hotspot you control.
- [ ] **MicroSD flashed with Pi OS 64-bit (Bookworm)** and booted.
- [ ] **SSH enabled on the Pi** — via Raspberry Pi Imager's advanced options when flashing, or `sudo raspi-config` → Interface → SSH.
- [ ] **M-305 USB mic physically plugged into the Pi** — into a USB port, before you check the device string.
- [ ] **You know how to reach the Pi** — either `pi-station.local` (mDNS) or its IP from `hostname -I` on the Pi.

### Human does once on the Pi (or have the LLM run these over SSH after connectivity is confirmed)
- [ ] `sudo apt update && sudo apt install -y alsa-utils sqlite3 libsqlite3-dev` — audio tools + SQLite.
- [ ] **Install Node 22 on the Pi** — `curl -fsSL https://fnm.vercel.app/install | bash` then `fnm install 22`. (Don't assume Pi OS ships Node 22.)
- [ ] `npm install -g pm2` — process manager (or use the systemd unit in `systemd/`).
- [ ] Optional: `sudo hostnamectl set-hostname pi-station` so `pi-station.local` resolves.

### LLM can verify once the Pi is reachable (run `scripts/preflight.sh --pi` *on the Pi*, or these from the laptop)
- [ ] **Connectivity** — `ping -c1 pi-station.local` (or the IP) succeeds.
- [ ] **SSH works passwordless-ish** — `ssh pi@pi-station.local 'echo ok'` returns `ok`. (Set up an SSH key first; otherwise it'll prompt for a password each deploy.)
- [ ] **Node 22 on the Pi** — `ssh pi@pi-station.local 'node --version'`.
- [ ] **`arecord` present** — `ssh pi@pi-station.local 'which arecord'`.
- [ ] **Mic enumerated** — `ssh pi@pi-station.local 'arecord -l'` lists a USB Audio Device. **Note the card number** → device string is `plughw:<card>,0`. Write the confirmed value into `devops/hardware/device-config.md` and set `AUDIO_DEVICE` in the Pi's `.env`.
- [ ] **Test capture** — `bash scripts/check-audio.sh` on the Pi records 5s and plays it back. Confirms the mic actually works.

### Done when
`./scripts/deploy-pi.sh pi-station.local` syncs + restarts, `curl http://pi-station.local:3456/status` returns `{ state: 'idle' }`, and with `AUDIO_SOURCE=arecord` a real Start produces transcript segments from your voice.

---

## Phase C — Real ElevenLabs transcription (optional for the demo)

Mock transcription is convincing on its own. Only do this if you want *live* speech-to-text in the demo.

- [ ] **`ELEVENLABS_API_KEY`** in the Pi's `.env` (never commit it; never expose to the dashboard).
- [ ] Set `STT_PROVIDER=elevenlabs`.
- [ ] Confirm the Scribe v2 realtime WS endpoint + wire format against current ElevenLabs docs (the adapter documents its assumptions in `docs/ARCHITECTURE.md`).
- [ ] **Outbound internet from the Pi** to `api.elevenlabs.io`. If the venue blocks it, fall back to `STT_PROVIDER=mock` — capture and the WAV buffer still work.

---

## Phase D — Real ApresMeet ingest (not needed for the demo)

The mock ingest endpoint inside the app covers the whole network-drop story. Real ingest is a later job (J3).

- [ ] `voice.apresmeet.com/ws/station/ingest` receiver built on the apm/PHP side (does not exist yet — J3).
- [ ] `VOICE_INGEST_URL` + `VOICE_INGEST_TOKEN` set, `PAIRING_MODE=remote` if using real pairing.

---

## The honest fallback order for hackathon day

1. **Pi + real mic + real ElevenLabs** — the full story, if everything connects.
2. **Pi + real mic + mock STT** — proves hardware capture + the offline-buffer demo; no dependency on ElevenLabs or venue internet.
3. **Laptop, full mock mode** — proves the entire product story with zero hardware. **This always works.** If the Pi or the venue network fights you, demo this and don't apologise — the whole point of the product is that it survives infrastructure failure.

> If anything physical fails on the day, drop down this list. Never let a missing cable or a blocked port stop the demo — mock mode is a first-class citizen precisely for this reason.
