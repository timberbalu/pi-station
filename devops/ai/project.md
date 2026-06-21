# pi-station — Job Run Log

> One entry per `job.md` execution. Append entries; never delete.

---

## 2026-06-13 — J1 full MVP build

- **Start:** 2026-06-13 (Codex session; preflight run before build)
- **End:** 2026-06-13 15:09:28 BST
- **Model/provider:** GPT-5 Codex
- **Prompt:** `devops/ai/prompts/PI_STATION_J1_full_mvp_build.md`
- **Outcome:** complete mock-first MVP implemented and verified locally
- **Files changed:** modular `src/` app rewrite; `fixtures/`; `test/`; `docs/`; `systemd/`; `scripts/check-audio.sh`; `.env.example`; `.gitignore`; `package.json`; `README.md`
- **Commands run:** `bash scripts/preflight.sh`, `npm install`, `npm run typecheck`, `npm test`, `npm run build`
- **Test results:** typecheck passed, 6 test files / 7 tests passed, production build passed
- **What works:** local dashboard, pairing, start/pause/resume/stop controls, rolling WAV chunks, mock transcript, SQLite queueing, mock ingest, network/STT simulation, report generation, offline-buffering demo flow
- **Stubbed/mocked:** mock audio source, mock transcript provider, mock ingest receiver, dormant GPIO, disabled LLM report summariser
- **Assumptions to revisit:** ElevenLabs realtime websocket wire format needs live J2 verification on hardware

## 2026-06-13 — J2b platform restructure

- **Start:** 2026-06-13 (post-J1 workspace refactor run)
- **End:** 2026-06-13 23:04 BST
- **Model/provider:** GPT-5 Codex
- **Prompt:** `devops/ai/prompts/PI_STATION_J2b_platform_restructure.md`
- **Outcome:** platform/workspace restructure completed; MeetStation now lives under `apps/meet-station`
- **Files changed:** root package/tsconfig; `shared/`; `core/`; `hardware/`; `apps/meet-station/`; `README.md`; `CLAUDE.md`; `.env.example`; `scripts/deploy-pi.sh`
- **Commands run:** `npm run typecheck`, `npm install`, `npm test`, `npm run build`, `npm run dev` (sandbox bind blocked)
- **Test results:** typecheck passed, 6 test files / 7 tests passed, build passed
- **What works:** workspace graph, MeetStation app path, all existing tests, build graph, deploy path updated to `apps/meet-station/dist/index.js`
- **Environment caveat:** Codex sandbox blocks binding to `0.0.0.0:3456`, so the final `npm run dev` socket check must be done outside this environment

## 2026-06-21 — J2 Pi provisioning (F365-164)

- **Start:** 2026-06-21 10:31 BST
- **End:** 2026-06-21 12:22 BST
- **Model/provider:** Claude Sonnet 4.6 (Cursor)
- **Prompt:** `devops/ai/prompts/PI_STATION_J2_pi_provisioning.md`
- **Outcome:** Pi provisioned and MeetStation running on real hardware with confirmed audio capture and faster-whisper transcription
- **Files changed:** `scripts/provision-pi.sh` (new), `scripts/deploy-pi.sh` (updated), `scripts/transcribe.py` (new), `core/src/config.ts` (faster-whisper STT option), `shared/src/PlatformConfig.ts` (STT type), `.env.example`, `devops/hardware/device-config.md`, `docs/PI_SETUP.md`, `devops/ai/diary.md`
- **Commands run:** `provision-pi.sh`, `deploy-pi.sh`, `curl /status`, `curl /start`, `curl /stop`, `arecord -l`, faster-whisper transcription
- **Test results:** API health OK, real 251KB WAV chunk written, faster-whisper transcribed real speech to 4 segments with word timestamps
- **Confirmed hardware:** M-305 on `plughw:2,0` (card 2), Node 22.23.0, pm2 auto-start via systemd, base.en model (142MB)
- **Deviations:** username `pistation` not `pi`; hostname `pistation.local` not `pi-station.local`; build on Mac not Pi; audio card 2 not 1

## 2026-06-21 — J3 Generic multi-component platform

- **Start:** 2026-06-21 12:24 BST
- **End:** 2026-06-21 12:45 BST
- **Model/provider:** Claude Sonnet 4.6 (Cursor)
- **Prompt:** `devops/ai/prompts/PI_STATION_J3_component_platform.md`
- **Outcome:** MeetStation refactored from a voice-only server into a generic component platform. VoiceComponent wraps existing capture/relay. VideoComponent stub added. Host fans out lifecycle to components, aggregates buffering state to drive the state machine. 35/35 tests green.
- **Files changed:**
  - New: `src/components/StationComponent.ts`, `components/voice/VoiceComponent.ts`, `components/video/VideoComponent.ts`, `components/registry.ts`, `test/componentHost.test.ts`, `test/aggregateState.test.ts`, `docs/COMPONENTS.md`
  - Modified: `MeetStationApp.ts` (host refactor), `index.ts` (component wiring), `core/src/config.ts` (ENABLED_COMPONENTS), `shared/src/PlatformConfig.ts`, `core/src/types.ts` (ComponentStatusSummary, components[] in StationStatusResponse), `.env.example`, `public/app.js` + `index.html` + `styles.css` (components row in dashboard), `test/api.smoke.test.ts` (updated for new constructor)
- **Test results:** 35 tests / 8 files — all green. typecheck clean. build clean.
- **Design decisions:** host owns state machine and reconciliation; VoiceComponent exposes `setReconcileCallback`; back-compat status fields still populated from VoiceComponent; unknown ENABLED_COMPONENTS id fails loudly at startup.
