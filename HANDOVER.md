# HANDOVER — MeetPaper Station / Pi-Station Platform
**Date:** 2026-06-13 (end of hackathon day, Blue Garage Lewisham)
**Prepared by:** Claude (claude.ai) for handover to Cursor or any capable LLM
**Recipient:** The next LLM session picking up this project

---

## Read this first, then follow the orientation chain

This file is a one-page briefing. The full detail lives in the devops files:

```
devops/ai/START_HERE.md   ← authoritative orientation (read first)
devops/ai/diary.md        ← full session log, every decision made today
devops/ai/memory.md       ← engineering contract, hard rules, patterns
devops/ai/job.md          ← current active job (STATUS: IN PROGRESS → J2)
devops/ai/prompts/        ← build prompts, one per job
```

**To continue work:** open the pi-station folder in Cursor, then paste:

```
study devops/ai/START_HERE.md, then devops/ai/diary.md and devops/ai/memory.md, then continue.
```

This chains through to `job.md` → the active prompt → and starts building. Full-auth mode is configured in `.claude/settings.json` — no approval prompts needed.

---

## What Pi-Station is

**Pi-Station is an edge platform** — the Raspberry Pi equivalent of F365. It hosts apps that run on Raspberry Pi hardware. It is not itself an app.

**MeetStation** is the first app. It is an audio/video capture and local intelligence layer for MeetPaper Voice Intelligence events. It sits physically in the room, guarantees three things regardless of network state, and syncs to the cloud when connectivity allows:

1. **Audio** — WAV buffer, always, gapless
2. **Video** — local MP4 chunks, always (J6, not built yet)
3. **Transcript** — faster-whisper STT, local, private (J5, not built yet)

**The tagline:** *"The room keeps recording. Even when the internet doesn't."*

**The product boundary:** Pi-Station does capture, local buffering, and sync. Everything else is the cloud's job. CoCo does post-session AI. MeetPaper does publishing. ElevenLabs is an optional admin-triggered quality upgrade, not a dependency.

---

## Ecosystem context

```
ApresMeet (PHP/MySQL/Elastic Beanstalk — repo: /Users/bijumenon/Sites/apm)
  └── MeetPaper → Voice Intelligence → voice.apresmeet.com
                                            ↑
                          Pi-Station syncs sessions here (J4 receiver not yet built)

Foundry365 (Node.js/TypeScript/ECS — repo: /Users/bijumenon/Sites/f365)
  └── [separate product — pi-station has NO runtime connection to f365]

Pi-Station (this repo — /Users/bijumenon/Sites/pi-station)
  └── apps/meet-station/  ← MeetStation, the first app
```

Pi-Station shares `tsconfig.base.json` from f365 for TypeScript compiler config only. No runtime coupling. No PostgreSQL. No ALLDO. No f365 imports at runtime.

---

## Repository structure (as of end of day)

```
pi-station/                         ← platform root
├── shared/   (@pi-station/shared)  ← PiApp interface, PlatformConfig
├── core/     (@pi-station/core)    ← DB, state machine, config, logger, sync stub
├── hardware/ (@pi-station/hardware)← PanTiltController + CameraController stubs (J6)
├── apps/
│   └── meet-station/               ← MeetStation app (all J1 code lives here)
│       ├── src/
│       │   ├── MeetStationApp.ts   ← main app class (was StationApp)
│       │   ├── capture/            ← AudioSource, WavChunkWriter, STT providers
│       │   ├── relay/              ← RelayService, SQLite queue, IngestClient
│       │   ├── control/            ← Fastify API, dashboard routes, simulate routes
│       │   ├── report/             ← ReportGenerator, reportHtml.ts
│       │   └── public/             ← dashboard (index.html, styles.css, app.js)
│       └── test/                   ← 6 vitest files, 7 tests — all green
├── devops/ai/                      ← LLM orientation files (START_HERE, diary, etc.)
├── devops/hardware/                ← Pi setup notes, device config, prerequisites
├── devops/design/                  ← MeetPaper visual reference for dashboard
├── scripts/                        ← deploy-pi.sh, provision-pi.sh (to be written in J2),
│                                      preflight.sh, check-audio.sh
├── docs/                           ← ARCHITECTURE.md, DEMO_SCRIPT.md, PI_SETUP.md
├── systemd/                        ← meetpaper-station.service
└── .claude/settings.json           ← full-auth permissions
```

---

## What was built today (J1 + J2b complete)

### J1 — Full mock-first MVP (complete, verified)
Built the complete MeetStation MVP in one Codex pass. Runs entirely on a laptop — no Pi, no mic, no ElevenLabs key, no internet needed.

- 7-table SQLite schema with auto-running migrations
- Finite state machine (IDLE → PAIRING → READY → RECORDING → OFFLINE_BUFFERING → SYNCING → REPORT_READY)
- Mock AudioSource + WavChunkWriter (rolling 30s WAV chunks, header repair on startup)
- Mock transcript provider (fixture lines from `fixtures/mock-panel-transcript.txt`)
- ElevenLabs Scribe v2 WS adapter (isolated, documented, needs live Pi verification)
- RelayService: SQLite queue, chronological flush, exponential backoff, idempotent by segment_id
- Fastify control API: `/status /pair /start /pause /resume /stop /mark /report/:id`
- `/simulate/network/down|up` and `/simulate/stt/drop|reconnect` — the demo engine
- `/mock/ingest` — in-process fake cloud receiver
- MeetPaper-styled vanilla JS dashboard (DM Serif masthead, amber OFFLINE banner, teal SYNCING)
- Styled HTML report on stop
- vitest suite: 6 files, 7 tests, all green
- `npm run typecheck` clean, `npm run build` clean

**To run the mock demo:**
```bash
cd /Users/bijumenon/Sites/pi-station
npm run dev
# open http://localhost:3456
```

Walk: Pair (code 482913) → Start → watch mock transcript → Mark Insight → Simulate network drop (amber banner) → Reconnect (teal, queue drains) → Stop → open report.

### J2b — Platform restructure (complete, verified)
Restructured from flat `src/` layout into 4 npm workspaces (shared/core/hardware/apps/meet-station). Pure move/rename refactor — zero logic changes, all 7 tests still green.

Notable: `core/src/sync/SyncService.ts` was scaffolded by Codex during J2b — ahead of schedule for J3b. Check its content before J3b runs.

---

## Active job — J2: Pi provisioning (F365-164, In Progress)

**Status:** BLOCKED on human-physical prerequisites. The LLM can do nothing until the Pi is network-reachable.

### What the human needs to do first (Part A)

The Pi is powered (green LED confirmed) but not yet reachable over SSH. The issue is almost certainly the Wi-Fi config was not set during flashing.

**Fix — re-flash the microSD card:**
1. Eject microSD from Pi, put in Mac card reader
2. Open Raspberry Pi Imager: https://www.raspberrypi.com/software/
3. Device: Raspberry Pi 5 | OS: Raspberry Pi OS (64-bit) | Storage: the microSD
4. Click Next → Edit Settings:
   - Hostname: `pi-station`
   - Username: `pi`, Password: (memorable)
   - Wi-Fi SSID + password: **same network as the Mac**
   - Tick Enable SSH → password authentication
5. Write, eject, put back in Pi, power on, wait 2 minutes
6. `ssh pi@pi-station.local` — should prompt for password
7. `ssh-copy-id pi@pi-station.local` — set up key auth for unattended Codex steps
8. Plug M-305 USB mic into any USB port on the Pi
9. Tell the LLM: "Part A done, Pi is at pi@pi-station.local" and say continue

**Note:** No Ethernet cable available. No USB networking option. Re-flash is the only path to SSH connectivity tonight.

### What the LLM does after Part A (Parts B–E)

Once the Pi is reachable, the LLM:
- Writes and runs `scripts/provision-pi.sh` (idempotent: alsa-utils, sqlite3, Node 22 via fnm, pm2)
- Creates `scripts/transcribe.py` (faster-whisper batch STT, outputs JSON)
- Extends `config.ts` to accept `STT_PROVIDER=faster-whisper`
- Deploys the built app via `scripts/deploy-pi.sh`
- Configures `.env` on the Pi (mock STT until ElevenLabs key provided)
- Verifies: `curl http://pi-station.local:3456/status`, dashboard loads, real WAV chunks written
- Sets up pm2 auto-start on reboot
- Updates `devops/hardware/device-config.md` with confirmed `AUDIO_DEVICE` string

**Full prompt:** `devops/ai/prompts/PI_STATION_J2_pi_provisioning.md`

---

## Job queue (Jira: F365-162 epic)

| Ticket | Job | Status |
|---|---|---|
| F365-162 | J1 — Mock-first MVP | ✅ Done |
| F365-163 | J2b — Platform restructure | ✅ Done |
| **F365-164** | **J2 — Pi provisioning** | 🟡 **In Progress — blocked on Part A** |
| F365-165 | J3 — Component platform (VoiceComponent, VideoComponent stub) | ⬜ Backlog |
| F365-166 | J3b — Sync Service (phased S3 sync, resumable, no data loss) | ⬜ Backlog |
| F365-167 | J4 — apm ingest receiver (manifest, presign, media, sync-complete) | ⬜ Backlog |
| F365-168 | J5 — Local STT (faster-whisper, post-session batch) | ⬜ Backlog |
| F365-169 | J6 — VideoComponent + AI HAT+ + pan/tilt servo tracking | ⬜ Backlog |
| F365-170 | J7 — Cloud upgrade path (admin re-submits to ElevenLabs) | ⬜ Backlog |

All prompts for J3, J3b exist in `devops/ai/prompts/`. J2, J5, J6, J7 need prompts written before Codex can run them.

---

## Key architectural decisions (do not reverse without flagging)

**Technology choices:**
- STT: ElevenLabs Scribe v2 (live, primary when online) + faster-whisper base.en (local batch, offline fallback). NOT Vosk — accuracy too low for professional events.
- Storage: SQLite on Pi (session data, queue), S3 (WAV + video chunks via presigned URLs — never through EB). NOT MySQL for media.
- Dashboard: vanilla HTML/CSS/JS. NOT React.
- LLM post-processing: CoCo in the cloud. NOT Ollama on the Pi — CoCo has real compute.
- TTS: not in scope. NeuTTS rejected.

**Architecture:**
- Media never streams through Elastic Beanstalk — presigned URL pattern only
- Pi never holds AWS credentials — PHP server mints presigned URLs
- S3 key structure: `vi-media/sessions/{session_id}/audio/chunk-NNNN.wav`
- Sync is event-level (post-session batch), not segment-level real-time, for the offline/Whisper path
- Two session association scenarios: pre-configured (Scenario A) and post-hoc (Scenario B → `pending_association` state in VI)
- Mock mode is first-class and must never be broken by real adapters

**Start/stop triggers (three layers, any can fire):**
1. MeetPaper Live Desk → `POST /start`, `POST /stop` via VI relay (primary, Scenario A)
2. Station dashboard (`http://pi-station.local:3456`) — direct control
3. GPIO physical button on Pi — zero software dependency (J6)

---

## Hardware available

- Raspberry Pi 5 (4GB) × 2 units
- Mini USB Microphone M-305 (USB class-compliant, no driver needed)
- MicroSD card (size unknown)
- Pi Camera Module (CSI ribbon — for J6)
- AI HAT+ (26 TOPS Hailo NPU — arriving Thursday, for J6 face detection)
- PCA9685 servo driver board (I2C — for J6 pan/tilt)
- MG996R + SG90 servos (for J6)
- OLED display (future)
- MAX98357 amp + wired speaker (future, optional)
- **No USB-C power bank** — single point of failure for power (to acquire)
- **No Ethernet cable** — connectivity via Wi-Fi only currently

---

## What to do right now

1. **Verify the mock demo works on the laptop** — `npm run dev` → `http://localhost:3456` → walk the demo. This is the guaranteed hackathon fallback regardless of Pi status.

2. **Re-flash the microSD** when ready (see Part A above). This unblocks J2 and everything that follows.

3. **When the Pi is reachable** — paste the one-liner into Cursor, tell it "Part A done, Pi is at pi@pi-station.local", and it handles the rest.

4. **AI HAT+ arrives Thursday** — when it does, check `devops/ai/memory.md §9` for setup notes and run `sudo apt install hailo-all && reboot` on the Pi, then `hailortcli fw-control identify`.

---

## One thing to check before running J3b

`core/src/sync/SyncService.ts` was scaffolded by Codex during J2b (ahead of schedule). Read it before running J3b to understand what's already there vs what the prompt expects to build. If it's a stub, J3b can build on it. If Codex went further, reconcile before running.

---

*Handover prepared end of day, 2026-06-13. All decisions documented in `devops/ai/diary.md`. All architectural principles in `devops/ai/memory.md`. All job prompts in `devops/ai/prompts/`.*
