# pi-station — Project Diary

> **What this file is.** The session log — dated entries for every significant build session, decisions made, findings surfaced, and where we left off. Read this alongside `memory.md` at the start of any new session.
>
> **Prompt:** *"study devops/ai/START_HERE.md, then devops/ai/diary.md and devops/ai/memory.md, then continue."*

---

## 2026-06-13 — Hackathon day (Agents in the Wild, Blue Garage Lewisham)

### Context

One Raspberry Pi 5 (4GB) borrowed for the day. Mini USB Mic M-305 available. Hackathon theme: hardware + AI. Project conceived in conversation with Claude (claude.ai) as the MeetPaper Station — a physical local ingestion server for MeetPaper Voice Intelligence.

### What was decided

**Project rationale:** MeetPaper's Voice Intelligence already handles resilience via a 24h interruption window and server-side recovery. But all of that is *recovery after failure*. The Pi gives us *prevention* — by moving audio capture off the browser entirely, a Wi-Fi drop at the venue no longer interrupts the session.

**Where it lives:** Standalone project at `/Users/bijumenon/Sites/pi-station`, added as a third folder in `foundry365.code-workspace`. Not an npm workspace member of f365 — avoids Pi-specific native modules (`better-sqlite3`, `arecord` bindings) polluting the Mac dev environment. Shares `tsconfig.base.json` from f365 for TypeScript config only.

**Not inside the `apm` repo:** apm is PHP + jQuery deployed to Elastic Beanstalk. Pi deploys via rsync + pm2 over SSH. Completely different deployment targets — mixing them would require careful `.ebignore` maintenance forever and risk pushing Node modules to EB.

### What was built

- Full project scaffold: `src/`, `devops/`, `scripts/`
- `src/config.ts` — environment config, typed, `as const`
- `src/capture.ts` — `CaptureService` extending `EventEmitter`: arecord spawn, ElevenLabs Scribe v2 WS, rolling WAV buffer (30s chunks), segment event emission, auto-reconnect
- `src/relay.ts` — `RelayService`: SQLite queue, POST to `voice.apresmeet.com`, exponential backoff flush, queue depth reporting
- `src/control.ts` — Fastify HTTP API: `/start /stop /pause /resume /pair /status`, CORS for Live Desk
- `src/index.ts` — entry point, boots all three services, graceful shutdown
- `scripts/deploy-pi.sh` — rsync + pm2 deploy script
- `devops/ai/` — full START_HERE / diary / memory / job / project / ideas structure mirroring f365

### What has NOT been done yet

- [ ] `npm install` on the Pi
- [ ] Physical test with arecord + M-305 mic
- [ ] Real ElevenLabs credentials in `.env` on the Pi
- [ ] `voice.apresmeet.com/ws/station/ingest` endpoint on the apm side (receiver not yet built)
- [ ] `POST /pair` validation against server (stub only)
- [ ] pm2 startup hook (`pm2 startup` on Pi)
- [ ] Audio device string confirmed (`arecord -l` on Pi)
- [ ] Mac dev substitute for arecord (sox/ffmpeg mock)

### Hardware confirmed available

- Raspberry Pi 5 (4GB) × 2 units (one in box, one bare board)
- Mini USB Microphone M-305 (USB class-compliant, plug-and-play, no driver needed)
- MicroSD card
- No USB-C power bank on hand today — single point of failure for power

### Open questions

1. **`plughw:1,0` assumption** — does the M-305 enumerate at device index 1 on Pi OS with no other peripherals? Verify with `arecord -l` on first boot.
2. **ElevenLabs Scribe v2 streaming API** — confirm the exact WS URL and session config JSON format against current ElevenLabs docs before first live test.
3. **`voice.apresmeet.com/ws/station/ingest`** — this endpoint needs to be built on the apm/VI side to receive POST payloads from pi-relay. What auth does it expect? Bearer token tied to the session code?
4. **Session pairing UX** — the 6-digit code concept is designed but the matching server-side `/ws/station/pair` validation endpoint does not exist yet.
5. **Mac dev audio mock** — needed before any meaningful local testing of the full pipeline. `sox` or `ffmpeg` piping a WAV file through stdout would substitute for `arecord`.

---

## Open issues

| # | Issue | Status |
|---|---|---|
| 1 | arecord device string confirmation on Pi | ⏳ pending first Pi boot |
| 2 | ElevenLabs Scribe v2 WS API format verification | ⏳ pending |
| 3 | `voice.apresmeet.com/ws/station/ingest` receiver endpoint (apm side) | ⏳ not built |
| 4 | Session pairing server-side validation | ⏳ not built |
| 5 | Mac dev audio mock (sox/ffmpeg) | ⏳ not built |
| 6 | pm2 startup hook on Pi | ⏳ pending Pi setup |
