# pi-station — Job Run Log

> One entry per `job.md` execution. Append entries; never delete.

---

## 2026-06-21 — J5 Local STT (faster-whisper)

- **Start:** 2026-06-21 BST
- **End:** 2026-06-21 BST
- **Model/provider:** Claude Opus (Cursor)
- **Prompt:** `devops/ai/prompts/PI_STATION_J5_local_stt.md`
- **Repo:** pi-station
- **Outcome:** faster-whisper wired as the post-session batch STT provider; offline transcript guarantee delivered behind the `STT_PROVIDER` interface. Mock/elevenlabs paths unchanged.
- **Files added:** `apps/meet-station/src/capture/FasterWhisperProvider.ts`, `apps/meet-station/src/capture/SilentTranscriptProvider.ts`, `apps/meet-station/test/fasterWhisperProvider.test.ts`, `apps/meet-station/test/voiceComponentBatchSTT.test.ts`
- **Files changed:** `core/src/config.ts`, `core/src/types.ts` (`batch_transcription` status + `BatchTranscriptionStatus`), `shared/src/PlatformConfig.ts`, `apps/meet-station/src/components/voice/VoiceComponent.ts`, `apps/meet-station/src/index.ts`, `apps/meet-station/src/MeetStationApp.ts`, `apps/meet-station/src/report/ReportGenerator.ts`, `apps/meet-station/src/public/app.js`, `.env.example`
- **Commands run:** `npm run typecheck`, `npm test`, `npm run build`
- **Test results:** typecheck clean; 15 files / 58 tests passed (48 prior + 10 new); build clean
- **What works (verified locally):** batch transcription on `stopSession()` in whisper mode with injected fake subprocess; chunk→session-relative timestamp shift; graceful empty-result on spawn error / non-zero exit / timeout; segments persisted `provider='faster-whisper'`; mock + elevenlabs unaffected (batch not called); status `batch_transcription` field; report note + dashboard indicator
- **Needs hardware to verify:** real-WAV transcription on the Pi via `venv-whisper` (deploy + `STT_PROVIDER=faster-whisper`, see job.md / diary deploy steps)
- **Decisions:** `transcribeFile` never throws (graceful empty per §7/§8, over §3 "throws"); added `SilentTranscriptProvider` so whisper mode records audio only (prevents mock-live double transcription); batch segments persisted to `transcript_segments` but not auto-enqueued to relay (follow-up if VI delivery of the local transcript is desired)

## 2026-06-21 — J4 apm ingest receiver (cross-repo: apm)

- **Start:** 2026-06-21 13:01 BST
- **End:** 2026-06-21 BST
- **Model/provider:** Claude Opus (Cursor)
- **Prompt:** `pi-station/docs/SYNC.md` (§"J4 — endpoints the apm side must implement")
- **Repo:** **apm** (`/Users/bijumenon/Sites/apm`) — PHP 8 / MySQL / Elastic Beanstalk
- **Outcome:** four-phase station sync receiver implemented on the apm side (manifest, presign, confirm, sync-complete) following apm conventions (`fc.php`, `ws/` endpoints, `obj/db/`, `obj/media/`, `devops/db/`)
- **Files added (apm):** `ws/station/index.php`, `ws/station/station_lib.php`, `ws/station/README.md`, `ws/station/tests/{test_helper,test_station_sync}.php`, `obj/db/voice/VIStationSession.php`, `obj/db/voice/VIMediaAsset.php`, `obj/media/S3MultipartHandler.php`, `devops/db/vi_station_sync.sql`, `.platform/nginx/conf.d/elasticbeanstalk/station.conf`
- **Files changed (apm):** `ec.php` (added `STATION_INGEST_KEY`)
- **Commands run:** `php ws/station/tests/test_station_sync.php`, `php -l` on all new files (MAMP php 8.2)
- **Test results:** 39/39 assertions passed; syntax clean on all 5 PHP source files
- **What works (unit-level):** route parsing, bearer auth, S3-key resolution (full + bare), media-meta parsing, multipart maths, ETag quoting; manifest idempotency (409 on repeat); presign create/resume; confirm → `VI_MEDIA_ASSETS` upsert; sync-complete → `SYNC_COMPLETE=1`
- **Needs live env to verify:** nginx subpath rewrite and real S3 multipart presign/complete (no AWS/nginx in this environment)

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

## 2026-06-21 — J3b Sync Service (offline → online via S3)

- **Start:** 2026-06-21 12:36 BST
- **End:** 2026-06-21 12:55 BST
- **Model/provider:** Claude Opus 4.8 (Cursor)
- **Prompt:** `devops/ai/prompts/PI_STATION_J3b_sync_service.md`
- **Outcome:** Host-level four-phase sync (manifest → segments → media to S3 → complete) via presigned URLs. Pi credential-free. Resumable multipart uploads. Connectivity probe drives OFFLINE_BUFFERING → SYNCING as a real signal. Full mock S3 path runs with zero AWS. 48/48 tests green.
- **Files changed:**
  - New (core): `sync/StationSyncClient.ts`, `sync/MediaUploader.ts`, `sync/ConnectivityProbe.ts`; `sync/SyncService.ts` (replaced stub); migrations + repositories (`sync_state`, `media_transfer_queue`); types + config (`sync` group); index exports
  - New (app): `control/mockStationRoutes.ts`; tests `connectivityProbe`, `syncResumable`, `manifestIdempotent`, `syncPhases`, `syncE2E`
  - New (docs): `docs/SYNC.md` (phases, resumability, mock mode, J4 contracts + `VI_MEDIA_ASSETS`)
  - Modified: `MeetStationApp.ts` (sync + probe wiring, `/status.sync`), `index.ts` (composition), `control/server.ts` (octet-stream parser + mock station routes), dashboard (`app.js`/`index.html`/`styles.css` sync section), `shared/PlatformConfig.ts`, `.env.example`, `core/package.json` (AWS SDK deps)
- **Test results:** 48 tests / 13 files — all green. typecheck clean. build clean.
- **Design decisions:** sync lives in `core/` (platform capability); presigned-URL fetch path (no AWS creds on Pi); S3 upload_id = resume token (no bytes_sent tracking); media phase marks empty types `skipped` so it never blocks; mock station + mock S3 honour the simulated-network flag.
- **Deviations:** AWS SDK deps added per spec but not imported (presigned-URL PUT via fetch needs no SDK auth on the Pi); audio fileSize includes the 44-byte WAV header.
