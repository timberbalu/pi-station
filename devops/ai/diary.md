# pi-station — Project Diary

> **What this file is.** The session log — dated entries for every significant build session, decisions made, findings surfaced, and where we left off. Read this alongside `memory.md` at the start of any new session.
>
> **Prompt:** *"study devops/ai/START_HERE.md, then devops/ai/diary.md and devops/ai/memory.md, then continue."*

---

## 2026-06-21 — J6: VideoComponent + AI HAT+ face detection + pan/tilt servo tracking (complete)

**84 tests green (58 prior + 26 new). typecheck + build clean.**

Hardware confirmed before build:
- Camera Module 3 (imx708) connected, working at 2304×1296 @ 30fps via `rpicam-hello`
- AI HAT+ active (PiSP BCM2712_C0 Hailo pipeline confirmed in libcamera output)
- M-305 USB mic on `plughw:2,0` (from J2)

### What was built

**Config (`core/src/config.ts`, `shared/src/PlatformConfig.ts`):**
- New `video` section: `videoSource`, `videoDir`, `facesDir`, `reportsDir`, `videoWidth/Height/Fps/ChunkSeconds/Bitrate`
- New `faceDetection` section: `provider` (mock|hailo|opencv), `hailoPostProcessFile`
- New `panTilt` section: `controller` (mock|pca9685), I2C address, channel assignments, physical limits, deadzone, smoothing
- `.env.example` was already updated (from J6 prompt prep); config.ts now matches

**StationEventBus (`core/src/state/StationEventBus.ts`):**
- New `audio_energy` event (`{ levelDb, speechActive }`) — SpeakerTracker subscribes to this
- CaptureService emits it on every audio chunk with a `-30 dB` speech threshold

**VideoSource (`apps/meet-station/src/components/video/`):**
- `VideoSource.ts` — interface: `start(sessionDir, onChunk)`, `stop()`, `isRunning()`
- `MockVideoSource` — emits one fake chunk immediately then on a 30s timer; creates placeholder MP4 files; no camera needed
- `LibcameraVideoSource` — spawns `rpicam-vid` with configurable width/height/fps/bitrate/chunkSeconds; watches video dir for new `.mp4` files via `fs.watch`; emits `VideoChunk` events; handles process errors gracefully

**FaceDetector (`hardware/src/camera/FaceDetector.ts`):**
- `FaceBox` interface: `{x, y, width, height, confidence, timestampMs}`
- `MockFaceDetector` — drifts a simulated face slowly across the 1280×720 frame on a 100ms timer
- `HailoFaceDetector` — spawns `rpicam-hello` with the Hailo JSON pipeline, parses stdout for `{"faces":[...]}` frames; auto-falls-back to MockFaceDetector if hailo-all not installed or HAT+ not detected

**PanTiltController (`hardware/src/servo/PanTiltController.ts`):**
- `PanTiltController` interface: `init()`, `setPosition(pan, tilt)`, `getPosition()`, `returnToNeutral()`, `shutdown()`
- `ConsolePanTiltController` — logs position changes; clamps nothing (accepts any degrees); used as mock and as PCA9685 fallback
- `PCA9685PanTiltController` — drives servos via I2C; dynamic `import('i2c-bus')` with graceful fallback on macOS; 50Hz PWM (1ms=102, 2ms=512 ticks); clamps to panMin/Max, tiltMin/Max; returns to neutral on shutdown
- `i2c-bus.d.ts` ambient declaration for TypeScript on macOS

**SpeakerTracker (`apps/meet-station/src/components/video/SpeakerTracker.ts`):**
- Subscribes to `bus.onAudioEnergy` — no direct coupling between VoiceComponent and VideoComponent
- On speech start: locks to the face nearest frame centre
- While locked: smooth-tracks the face with low-pass filter (alpha = 1 - smoothing coefficient)
- Deadzone: skips movement if face is within ±deadzonePx of frame centre
- On 2s silence: releases lock, returns servo to neutral
- If locked face leaves frame: releases lock immediately
- `buildSpeakerTrackerConfig()` factory with sensible defaults (0.07 deg/px scale)

**VideoComponent (`apps/meet-station/src/components/video/VideoComponent.ts`):**
- Full implementation replacing J3 stub — implements `StationComponent`
- `init()`: builds VideoSource, FaceDetector, PanTiltController, SpeakerTracker from `ctx.config`
- `startSession()`: creates session video dir, starts VideoSource + FaceDetector
- Each new video chunk: enqueues in `media_transfer_queue` (s3Key = `vi-media/sessions/{id}/video/chunk-NNNN.mp4`) — SyncService phase 3 picks this up automatically
- Face data persisted to `{facesDir}/{sessionId}/faces/{chunkIndex}-faces.json`
- Handles VideoSource/FaceDetector startup failures gracefully — sets `healthy=false`, logs clearly, never crashes
- `getStatus()` detail includes: source, running, chunks, detector, panTilt position, tracking status

**SessionDirs (`apps/meet-station/src/SessionDirs.ts`):**
- `createSessionDirs(sessionId, config)` — creates full session directory tree atomically
- Integrated into `MeetStationApp.start()` before component fan-out

**SessionCleaner (`apps/meet-station/src/SessionCleaner.ts`):**
- `clean(sessionId)` — deletes WAV + MP4 files; keeps transcripts, face JSON, reports, SQLite
- Guards: refuses to clean if `sync_complete != 1`
- `POST /sessions/:id/cleanup` route added to `routes.ts`
- Wired into `MeetStationApp` as optional last constructor param; exposed via `cleanSession()`

**Data migration (`scripts/migrate-data-dir.sh`):**
- Idempotent script to move data from inside-app to `/home/pistation/data/meet-station/`
- Migrates SQLite and audio sessions if present

**Dashboard (`apps/meet-station/src/public/app.js`):**
- Video component card shows: source, chunks captured, detector, servo position (pan°/tilt°), tracking status ("Tracking Speaker", "Scanning", "Idle")

### Decisions

- **VideoComponent gets config from `ctx.config` in `init()`, not constructor** — keeps registry clean; `new VideoComponent()` still works with no args.
- **Video chunks stored in `media_transfer_queue` directly** (not in `audio_chunks` table, which has no `media_type` column) — avoids schema migration that would break existing tests. SyncService phase 3 already reads from `media_transfer_queue` for both audio and video.
- **`FasterWhisperProvider.transcribeFile` never throws** — matches the decision from J5 (graceful empty-on-error).
- **SpeakerTracker deadzone at face centre ±20px** — avoids jitter when the camera is roughly aligned.
- **PCA9685 i2c-bus via dynamic import** — fails gracefully on macOS; `i2c-bus.d.ts` ambient declaration keeps TypeScript happy.
- **`HailoFaceDetector` falls back to `MockFaceDetector`** on spawn error or process exit — production never hard-fails because the camera module crashed.

### Test count: 84 tests (26 new)

New test files: `videoComponent.test.ts` (7), `faceDetector.test.ts` (3), `panTilt.test.ts` (6), `speakerTracker.test.ts` (5), `sessionDirs.test.ts` (2), `sessionCleaner.test.ts` (3). Updated: `componentHost.test.ts` (VideoComponent stub tests now use real context).

### Pi deploy (for next physical session)

```bash
npm run build && bash scripts/deploy-pi.sh pistation@pistation.local
# On Pi .env:
#   VIDEO_SOURCE=libcamera
#   FACE_DETECTION=hailo
#   PAN_TILT=pca9685  (only if PCA9685 + servos are wired)
#   VIDEO_DIR=/home/pistation/data/meet-station/sessions
#   FACES_DIR=/home/pistation/data/meet-station/sessions
#   REPORTS_DIR=/home/pistation/data/meet-station/reports
# First run:
#   bash scripts/migrate-data-dir.sh pistation@pistation.local
#   pm2 restart pi-station
# Test: ENABLED_COMPONENTS=voice,video then pair → start → wait 30s → stop
```

---

## 2026-06-21 — J5: Local STT (faster-whisper) (complete)

**58 tests green (48 prior + 10 new). typecheck + build clean. Mock/elevenlabs paths untouched.**

J5 wires faster-whisper in as the **post-session batch** transcript provider, delivering the offline-transcript guarantee: a usable transcript exists even if ElevenLabs was unreachable for the whole event.

### What was built (pi-station)

- `apps/meet-station/src/capture/FasterWhisperProvider.ts` — batch provider. `transcribeFile(wav, timeoutMs)` spawns `scripts/transcribe.py`, parses JSON; `transcribeSession(id, chunks, sessionStartMs)` runs chunks in order and shifts each segment's timestamps to session-relative (adds `chunk.startMs`). **Never throws** — spawn error / non-zero exit / timeout / bad JSON all log and yield zero segments, honouring "recording (and the session) never crashes". `spawn` is injectable for tests.
- `apps/meet-station/src/capture/SilentTranscriptProvider.ts` — no-op live `TranscriptProvider` used when `STT_PROVIDER=faster-whisper`, so the live session captures **audio only** and the batch pass is the single transcript source (no double transcription). Reports `connected` for the status widget.
- `VoiceComponent` — `stopSession()` now runs `runBatchTranscription()` when provider is faster-whisper: lists `closed`/`repaired` chunks, calls the provider, persists segments with `provider='faster-whisper'`, `speaker_label='SPEAKER_0'` (no diarisation in base.en), `confidence=0.9`. Exposes `getBatchTranscriptionStatus()`.
- Status: `/status.stt.batch_transcription` = `{ available, model, status: idle|running|complete|error }`.
- Report: when whisper produced the transcript, the note states local provider + "diarisation not available" + ElevenLabs upgrade path.
- Dashboard: STT card shows `batch <status>`; a "TRANSCRIBING LOCALLY" banner shows while `STOPPING` in whisper mode.
- Config: `FASTER_WHISPER_PYTHON`, `FASTER_WHISPER_VENV_DIR` (set → uses `<dir>/bin/python3`), `FASTER_WHISPER_TIMEOUT_MULTIPLIER` (per-chunk timeout = multiplier × chunk duration, floor 30s). Added to `core/config.ts`, `shared/PlatformConfig.ts`, `.env.example`.

### Decisions

- **`transcribeFile` never throws** — the J5 prompt §3 says "throws on script error" but §7/§8 require graceful empty-on-error. Resolved in favour of graceful: safer (session always completes) and matches the testable contract.
- **SilentTranscriptProvider** is an addition beyond the literal prompt: without it, whisper mode would fall through to the mock live provider and fabricate live segments that the batch pass then duplicates. The silent provider is the correct production behaviour for an offline/batch STT.
- Batch segments are **persisted to `transcript_segments`** per the prompt. They are **not** auto-enqueued to the relay queue, so SyncService phase-2 (which drains the relay queue) does not currently push the batch transcript to VI. Flagged as a follow-up (see below).

### Not done / follow-ups

- **Relaying the batch transcript to VI**: batch segments land in `transcript_segments` but not the relay queue. If the product wants the local whisper transcript delivered to VI automatically (vs. only on the J7 ElevenLabs upgrade), enqueue them in `runBatchTranscription` (e.g. via `relay.handleCommittedSegment`). Left out to match the J5 spec and keep tests deterministic.
- **Pi smoke test pending**: deploy + real-WAV transcription on the Pi not yet run from this session (see deploy steps in the J5 prompt §9). `venv-whisper` + `base.en` already installed from J2.

### Pi deploy (for next physical session)

```
npm run build && bash scripts/deploy-pi.sh pistation@pistation.local
# on Pi .env: STT_PROVIDER=faster-whisper
#             FASTER_WHISPER_VENV_DIR=/home/pistation/pi-station/venv-whisper
# (FASTER_WHISPER_PYTHON falls back to system python3 if VENV_DIR is empty)
pm2 restart pi-station
# start → speak → stop → wait ~30-60s → GET /transcript
```

---

## 2026-06-21 — J4: apm ingest receiver (complete) — *cross-repo: apm, not pi-station*

**39/39 PHP unit assertions green. `php -l` clean on all new files.**

J4 is the **apm/PHP** side of the J3b sync contract (apm repo at `/Users/bijumenon/Sites/apm`, PHP 8 / MySQL / Elastic Beanstalk). The Pi side shipped in J3b; this implements the four endpoints it calls.

### What was built (apm)

- `ws/station/index.php` — front controller: Bearer auth (`STATION_INGEST_KEY`), route parse, dispatch
- `ws/station/station_lib.php` — pure helpers (route parse, bearer extract, S3-key resolve, media-meta parse, multipart maths, ETag quoting) — unit tested, no DB/SDK
- `obj/db/voice/VIStationSession.php` — `VI_STATION_SESSIONS` model (manifest upsert + sync-complete). Keyed by the Pi's **string** session id, separate from the int-keyed `VI_SESSIONS` recorder flow
- `obj/db/voice/VIMediaAsset.php` — `VI_MEDIA_ASSETS` model, idempotent upsert on `(SESSION_ID, MEDIA_TYPE, CHUNK_INDEX)`
- `obj/media/S3MultipartHandler.php` — S3 multipart create / presign-parts / complete, via the existing `ext/aws/aws.phar` (same pattern as `S3Handler.php`)
- `devops/db/vi_station_sync.sql` — both tables (the `VI` database)
- `.platform/nginx/conf.d/elasticbeanstalk/station.conf` — `/ws/station/*` → front controller rewrite
- `ec.php` — `STATION_INGEST_KEY` constant (matches the `RADAR_API_KEY` / `SIGNALS_API_KEY` pattern)
- `ws/station/README.md` + `ws/station/tests/`

### Key contract finding (important for interop)

`docs/SYNC.md` shows `key=audio/chunk-0001.wav` (bare), but the **shipped Pi code** (`MediaUploader`) sends `record.s3Key` — the **full** key `vi-media/sessions/{id}/audio/chunk-0001.wav` — to both presign and confirm. The receiver treats `key` as the literal object key and **also** tolerates the bare form (prefixes it). `confirm` returns `s3_key` = the resolved key, matching the mock the Pi e2e-tested against.

### Decisions

- **No AWS creds on the Pi** preserved: apm presigns `UploadPart` URLs; the Pi PUTs straight to S3.
- **Stateless multipart on apm**: the Pi holds `upload_id` + confirmed parts; apm only creates the upload, presigns remaining parts (`from_part`), and completes. No server-side multipart bookkeeping table needed.
- **Separate `VI_STATION_SESSIONS`** rather than overloading `VI_SESSIONS` — avoids string/int id collision and leaves the browser recorder untouched.
- ETags: the Pi strips quotes; apm re-quotes for `completeMultipartUpload`.

### Not done / follow-ups

- Phase 2 (transcript segments) reuses the existing voice relay path — out of J4 scope.
- CoCo auto-process trigger on sync-complete is a stub hook (later job).
- nginx rewrite + S3 multipart can only be fully verified on a deployed EB env (no live AWS/nginx here); logic is unit-tested and `php -l` clean.

---

## 2026-06-21 — J4: apm ingest receiver (complete)

**39/39 PHP unit assertions pass. php -l clean. Built on apm codebase.**

### What was built (in /Users/bijumenon/Sites/apm)

Four endpoints under `https://voice.apresmeet.com/ws/station`:
- `POST /sessions` — manifest (idempotent: `200 {existing:false}` new, `409 {existing:true}` repeat)
- `GET /sessions/{id}/media/presign` — S3 multipart `upload_id` + presigned part URLs (resumable via `from_part`)
- `POST /sessions/{id}/media/confirm` — completes multipart upload, records `VI_MEDIA_ASSETS`
- `POST /sessions/{id}/sync-complete` — sets `SYNC_COMPLETE = 1`

New files: `ws/station/index.php`, `ws/station/station_lib.php`, `obj/db/voice/VIStationSession.php`, `obj/db/voice/VIMediaAsset.php`, `obj/media/S3MultipartHandler.php`, `devops/db/vi_station_sync.sql`, `.platform/nginx/conf.d/elasticbeanstalk/station.conf`, `ws/station/README.md` + tests.

Changed: `ec.php` (added `STATION_INGEST_KEY`, matching existing `RADAR_API_KEY`/`SIGNALS_API_KEY` pattern).

### Key decisions

- **No AWS creds on Pi preserved** — apm presigns `UploadPart` URLs; Pi PUTs straight to S3. apm’s multipart handling is stateless (Pi holds `upload_id` + confirmed parts).
- **Contract correction:** `MediaUploader` sends the full `s3Key` (`vi-media/sessions/{id}/audio/chunk-0001.wav`) as `key`, not the bare path shown in `SYNC.md`. Receiver uses `key` literally and tolerates the bare form.
- **Separate `VI_STATION_SESSIONS`** (string-keyed) rather than overloading int-keyed `VI_SESSIONS` recorder flow — no collision, recorder untouched.
- **ETags re-quoted** for `completeMultipartUpload` (Pi strips quotes; apm re-adds them as S3 requires).

### Verification

- 39/39 PHP unit assertions pass
- `php -l` clean on all five source files (MAMP PHP 8.2)
- nginx rewrite + real S3 multipart not yet exercised (no live EB/AWS) — needs deployed env; logic unit-tested, deploy steps in `ws/station/README.md`

### ⚠️ Security note (pre-existing, flagged by J4 build)

`cc.php` and `ec.php` contain live AWS and API keys in plaintext. Pre-existing issue, not introduced by J4. **These credentials should be rotated and moved to environment variables / AWS Secrets Manager before any public sharing of the apm repo.** Treat as a priority action item.

### Not yet committed

apm and pi-station changes not committed. Commit both repos together to keep the cross-repo work in sync.

---

## 2026-06-21 — J3b: Sync Service — offline→online via S3 (complete)

**48/48 tests green (+13). Typecheck clean. Build clean. Pushed to main.**

### What was built

**core/src/sync/:**
- `StationSyncClient` — HTTP contract: manifest / presign / confirm / sync-complete
- `MediaUploader` — resumable multipart. S3 `upload_id` is the resume token; confirmed parts persist in `parts_json`; re-run requests presigned URLs only for parts beyond the highest confirmed part
- `ConnectivityProbe` — fires `online`/`offline` only on transitions (no repeat firing)
- `SyncService` — four-phase orchestrator (replaced the J3b stub cleanly)
- `sync_state` + `media_transfer_queue` tables + typed repositories

**Four phases (each gated on previous, resumes from failed phase):**
1. Manifest — tiny JSON to apm; idempotent (409 = existing, not an error)
2. Segments — existing relay queue drains to depth 0 via `flushSegments()` injection
3. Media → S3 — presign → PUT parts directly to S3 → confirm; Pi holds no AWS credentials
4. Sync-complete — tiny JSON; sets `sync_complete = 1`; CoCo can pick up

**S3 key structure confirmed:** `vi-media/sessions/{session_id}/audio/chunk-NNNN.wav`

**App side:**
- Mock station + mock S3 routes (full story runs with zero AWS, honours `/simulate/network/down`)
- Host wiring: `stop()` syncs before report; network-up triggers a cycle; probe runs while OFFLINE_BUFFERING
- `/status.sync` field added
- Dashboard — "Sync to Cloud" section with per-phase and per-chunk progress

**Tests (+13):** `connectivityProbe`, `syncResumable`, `manifestIdempotent`, `syncPhases`, `syncE2E` (full path through real server + mock S3)

**docs/SYNC.md** — phases, resumability, mock mode, and precise J4 endpoint contracts + `VI_MEDIA_ASSETS` table for the apm side

### Deliberate deviation

AWS SDK deps added to `core/package.json` but not imported — the presigned-URL `fetch` PUT path needs no SDK auth on the Pi. Kept for forward S3-side work. Noted in open-issues.

### Verified
- Phase gating correct — each phase stops cycle if incomplete
- Resumability — re-run requests only parts beyond highest confirmed part
- `uploadMediaType` correctly marks `skipped` when no chunks exist (doesn’t block)
- `flushSegments` injection keeps host in control of segment draining
- Mock S3 respects `/simulate/network/down` correctly

---

## 2026-06-21 — J3: Generic multi-component platform (complete)

**35/35 tests green. Typecheck clean. Build clean. Pushed to main.**

### What was built

- `components/StationComponent.ts` — interface: `init`, `startSession`, `pause`, `resume`, `stopSession`, `flush`, `getStatus`, `contributeToReport`, `shutdown`. Also defines `ComponentContext`, `ComponentStatus`, `ComponentReportSection`.
- `components/voice/VoiceComponent.ts` — wraps existing `CaptureService` + `RelayService` with zero behavioural changes. Exposes `setReconcileCallback` so the host drives state machine transitions.
- `components/video/VideoComponent.ts` — dormant stub. Registers, reports `healthy: true, buffering: false, queuedItems: 0`. Proves the abstraction.
- `components/registry.ts` — parses `ENABLED_COMPONENTS` env var. Fails loudly on unknown IDs. `voice` = pre-constructed VoiceComponent; `video` = new VideoComponent(). Type-safe `as const` tuple of known IDs.
- `MeetStationApp` constructor now accepts `StationComponent[]` — all lifecycle methods fan out to every component.
- `reconcileOperationalState` folds over `components[].getStatus().buffering` — any component buffering → `OFFLINE_BUFFERING`.
- `GET /status` gains `components: ComponentStatus[]` array; back-compat `mic`/`stt`/`relay`/`buffer` fields preserved.
- Dashboard gets a Components row — card per component showing healthy/buffering/queued state.
- `test/componentHost.test.ts` — 11 tests: registry, VideoComponent lifecycle, fan-out.
- `test/aggregateState.test.ts` — 17 tests: pure aggregate-buffering logic for 1 and 2 components.
- `docs/COMPONENTS.md` — how to add a new component.

### Verified

- `ENABLED_COMPONENTS=voice,video` boots with dormant video card
- `ENABLED_COMPONENTS=voice` boots without it
- Unknown ID → clear startup error
- All 7 original tests still green (35 total: 7 original + 11 componentHost + 17 aggregateState)

### SyncService state (important for J3b)

`core/src/sync/SyncService.ts` is a **clean stub** — a single empty class with a one-line comment: "Placeholder for J3b. The platform-level sync coordinator lives here once manifest/media upload phases exist." J3b can build on this directly with no reconciliation needed.

---

### What changed

The repo is now structurally a platform:

- `shared/` added with `PiApp` and `PlatformConfig` contract types.
- `core/` added and now owns config, logger, DB, state, and the existing console/GPIO-safe hardware control.
- `hardware/` added with stable stub paths for `PanTiltController` and `CameraController`.
- `apps/meet-station/` added and now contains the former app logic from repo-root `src/`, including `MeetStationApp`, capture, relay, control, report, public assets, tests, and fixtures.
- Root `package.json` now defines npm workspaces.
- Root `tsconfig.json` now uses project references across the workspace graph.
- Old repo-root `src/` removed.

### What did not change

- The MeetStation behavior stayed intact.
- The 7 existing tests still pass.
- The mock transcript / offline-buffering / report flow was preserved.
- No application logic was intentionally changed; this was a move/rename/package-boundary refactor.

### Runtime note

`npm run dev` now uses `node --import tsx/esm apps/meet-station/src/index.ts` rather than the `tsx` CLI. Reason: the sandbox here rejects the IPC pipe used by the `tsx` CLI. With the loader path, the app bootstraps successfully through hardware init, but this Codex environment still blocks binding to `0.0.0.0:3456` with `listen EPERM`. That is an environment restriction, not an app failure. Outside the sandbox, the dev command is the correct entrypoint to verify the live dashboard.

### Verification

- `npm install` rerun after workspace manifests changed
- `npm run typecheck` passed
- `npm test` passed (6 files / 7 tests)
- `npm run build` passed

### Follow-on

The next real job is still J2 Pi provisioning. J2b was the internal architecture cleanup that gets the platform shape correct before real hardware deployment.

## 2026-06-13 (evening) — Pi-Station is a platform; MeetStation is the first app

**The fundamental reframing:** Pi-Station is not an app. It is an **edge platform** — the Raspberry Pi equivalent of F365. From now on, Pi-Station hosts apps. The first app is **MeetStation** (the audio/video capture and intelligence layer for MeetPaper Voice Intelligence events).

This mirrors F365 exactly:
- F365 platform → Pi-Station platform
- MeetPaper app in F365 → MeetStation app in Pi-Station
- F365 npm workspaces (shared/server/client) → Pi-Station workspaces (shared/core/hardware/apps/meet-station)

**Name chosen: MeetStation.** Biju's choice. It says exactly what it is: a Meet-family product that lives on the Station. Consistent with MeetPaper, MeetLive, etc.

**The platform contract:** `PiApp` interface in `shared/src/PiApp.ts`. Every future Pi-Station app implements this interface. The platform owns: device identity, SQLite, sync service, hardware abstraction, offline-resilience guarantee. Apps own: capture logic, local buffers, relay, dashboard contribution, report section.

**J2b written:** a platform restructure job that moves everything from the flat `src/` layout into the workspace structure above. Pure move/rename refactor — zero logic changes, all 7 tests must still pass, mock demo must run identically. Builds before J2 (Pi provisioning) so the Pi gets the correct architecture from day one.

**New workspace structure:**
```
pi-station/
  shared/          (@pi-station/shared) — PiApp interface
  core/            (@pi-station/core) — DB, state, config, logger
  hardware/        (@pi-station/hardware) — servo/camera stubs (J6)
  apps/
    meet-station/  (@pi-station/meet-station) — MeetStation (J1 code, moved)
```

---

**Quickstart doc (Quickstart — Edge AI on a Raspberry Pi) key findings:**

- **STT recommendation is Vosk, not Whisper.** Vosk is ~50MB, runs offline on CPU, gives live streaming transcription. The doc explicitly says “if you need higher accuracy and don’t mind it being slower, swap in faster-whisper with the base.en model.” Vosk is the correct live STT for a 4GB Pi — supersedes earlier plan to use whisper.cpp for live transcription. faster-whisper (base.en) is the quality upgrade for post-session batch.
- **Ollama confirmed for the Pi** (Gemma 2 2B recommended, ~1.8GB RAM, 3–5 words/sec). Stands as a hackathon demo option but not a product dependency (CoCo handles this in production).
- **NeuTTS confirmed as TTS** — runs on CPU, not the HAT+. The MAX98357 amp + wired speaker in the kit provides audio output (Pi 5 has no headphone jack). Reconsidered for spoken station announcements behind a feature flag.
- **AI HAT+ rule of thumb confirmed:** HAT+ for live camera vision, CPU for everything else (STT, TTS, LLM).
- **Kit also contains:** PCA9685 servo driver, MG996R + SG90 servos, OLED display, VL53L0X distance sensor, MAX98357 amp, wired speaker, 3D printer for enclosures.

**Pan/tilt speaker-tracking camera — confirmed viable with the kit:**
Biju proposed a motorised camera that swivels to track whoever is speaking, locking voice + face together. Fully feasible with: AI HAT+ face detection (30fps, no CPU cost) + PCA9685 (I2C) + MG996R pan servo + SG90 tilt servo. Standard PWM servos cover 0–180 degrees — covers the frontal arc of a seated panel. 360-degree sweep needs continuous-rotation servos (not in kit). Voice-face locking heuristic: VAD energy threshold on audio stream → lock to nearest face on speech start → smooth servo tracking → release on 2s silence. This becomes the VideoComponent’s physical intelligence layer.

**Revised STT provider stack:**
1. `MockTranscriptProvider` — dev/demo
2. `VoskProvider` — live, offline, default on Pi
3. `FasterWhisperProvider` — quality batch, post-session
4. `ElevenLabsRealtimeProvider` — cloud, highest quality, admin-triggered

---

### Session association — two scenarios

**Scenario A (pre-configured):** Organiser creates VI session in MeetPaper before the event and specifies "recorded by Pi-Station". Station pairs before the event; VI database already has the session record. Phase 1 manifest is pre-established. Segments and media sync to a known session on reconnect.

**Scenario B (post-hoc):** Organiser doesn't set this up. Pi captures everything locally. On sync, the manifest arrives at VI as an "unassociated recording" — no event mapping yet. VI holds it in a pending state (`session_state = 'pending_association'`). Organiser gets a notification in MeetPaper admin: "Unassociated Station recording available — 2h 4min from 13 June. Associate with an event?" Once associated, CoCo pipeline fires.

Both scenarios are valid. The UI distinction is in MeetPaper (apm), not in pi-station. Pi-station sends the same manifest either way.

### Compacting sync model

Biju introduced the "compacting" analogy — analogous to how AI context windows compact older conversation into a summary. The Station should not attempt continuous sync during the event. Instead:

- **During event:** capture runs continuously (audio + video → disk, Whisper runs periodically). No sync. SQLite accumulates everything locally.
- **On stop (or periodic checkpoint):** Station compacts the session — consolidates WAV chunk index, flushes pending Whisper segments, builds the full session manifest. *Then* attempts sync.
- **Sync is event-level, not segment-level real-time.** The session finishes first; the sync happens after. This is a meaningful architectural decision: it means the relay queue model (segment-by-segment live posting) is the *live ElevenLabs path*, and the compacting sync model (post-event batch) is the *local Whisper + offline path*.

These two paths coexist in the same SyncService:
- **Live path (Scenario A, ElevenLabs online):** segments post in real-time via RelayService. Audio/video media sync post-session via SyncService Phase 3.
- **Offline/Whisper path:** everything syncs post-event in one compacting cycle. RelayService has nothing to flush (no live ElevenLabs); SyncService handles everything: manifest → Whisper transcript → media files → complete.

### AI HAT+ — changes the VideoComponent architecture significantly

Biju receives the AI HAT+ (13 or 26 TOPS) by Thursday. Key facts:
- Hailo NPU connected via Pi 5 PCIe Gen 3 interface
- Auto-detected by Pi OS — `rpicam-apps` natively offloads vision post-processing to the NPU
- 26 TOPS variant: runs multiple neural networks simultaneously — object detection + pose estimation + face recognition all at once on a single video feed, no dropped frames
- Does NOT accelerate Whisper (not a vision model — runs on CPU regardless)
- Models must be compiled to Hailo format on x86 laptop first, then copied to Pi

For VideoComponent (J6), the AI HAT+ enables: real-time speaker face detection, face-to-speaker-label mapping, slide capture detection — all running on the NPU with zero CPU overhead during recording. This upgrades VideoComponent from "raw video chunks" to "annotated video chunks with face timestamps and slide markers."

For the two-Pi architecture: Pi 1 (AI HAT+) = intelligent capture node (camera + audio + NPU face detection during session); Pi 2 = processing node (Whisper on CPU post-session + sync service + control API). This is the production architecture; for the hackathon, one Pi covers everything.

---

Biju confirmed: voice and video chunks should be stored in S3, not in MySQL. This is consistent with the existing ecosystem architecture — both ApresMeet ("Media storage: AWS S3 (audio, images, transcripts)") and Foundry365 ("S3 Media files, audio recordings, transcripts") already use S3. This isn't a new decision; it's an extension of the established pattern.

**Key architectural implication — presigned URLs, not proxy uploads:**
Large binary files (WAV chunks, video MP4s) must never be streamed through the PHP/Elastic Beanstalk application server. EB is not built for that and it would hammer web workers unnecessarily. The correct pattern is:
1. Pi asks PHP server for a presigned S3 URL (tiny request)
2. Pi uploads binary directly to S3 (bypasses EB entirely)
3. Pi confirms completion to PHP server (tiny request)
4. PHP calls `completeMultipartUpload` on S3

This is also how the Pi stays credential-free — it never holds AWS keys. The PHP server generates presigned URLs using its own credentials (which it already has).

**S3 key structure decided:** `vi-media/sessions/{session_id}/audio/chunk-NNNN.wav` (and `/video/` equivalent). Zero-padded so lexicographic = chronological. This is what CoCo reads, what the ElevenLabs upgrade path sends to Scribe, and what MeetPaper serves via CloudFront.

**Resumability via S3 multipart upload IDs:** No need to track `bytes_sent` in our own table — S3's `upload_id` is the native resume token. Pi stores `upload_id` + confirmed `etag` per part in `media_transfer_queue`; on reconnect, resumes from the last confirmed part. S3 keeps multipart uploads alive for 7 days.

**New apm-side table:** `VI_MEDIA_ASSETS` records every uploaded chunk with its S3 key. CoCo reads this to find session media. J7 (cloud upgrade path) reads it to trigger ElevenLabs re-processing on the correct audio key.

J3b prompt fully rewritten to reflect the S3 architecture.

---

## 2026-06-13 (evening) — Sync Service identified as critical missing piece (J3b)

Biju raised the right question: how does the Pi transition from offline to online without data loss when it has three streams (audio WAV, transcript segments, future video MP4) all needing to reach the VI database?

The existing `RelayService` handles transcript segments correctly but has no concept of:
- A session manifest (VI needs to know the session exists before accepting segments)
- Media file transfer (large binaries, not segment-shaped)
- A sync-complete signal (VI has no way to know the Pi is done)
- Resumability across all streams (if the connection drops again mid-sync)

**Decision: add J3b (Sync Service) between J3 and J4.** It is a host-level service (not a component) that coordinates a four-phase sync protocol:
1. Manifest first — POST session metadata; gate everything else on this
2. Transcript segments — existing RelayService, unchanged, just gated on phase 1
3. Media files — chunked upload with Content-Range, resumable by bytes_sent offset
4. Sync-complete signal — VI marks session fully received; Pi marks sync_complete=1

New tables: `sync_state` (per-session, tracks each phase's status) and `media_transfer_queue` (per-file, tracks bytes_sent for resumability). A `ConnectivityProbe` drives the `OFFLINE_BUFFERING → SYNCING` transition as a real network health signal rather than an inferred state.

The dashboard `SYNCING` banner becomes genuinely informative — shows each phase ticking to ✓ — rather than just a queue depth counter. This is what makes the offline-to-online story trustworthy to an organiser watching it happen.

J3b also documents the apm-side endpoint contracts (manifest, media upload, sync-complete) so J4 builds the right receiver without ambiguity.

---

**The diagram Biju drew changes the framing of the whole product.** Pi-Station is not a resilience device that buffers when the internet drops. It is a **local intelligence node** — a first-class compute device that does real work on the local side of unreliable connectivity, permanently.

The three roles as Biju defined them:
1. **Storage** — WAV, SQLite, transcripts. Always.
2. **Private AI processing** — Whisper STT locally by default. Audio never leaves the room until the admin decides.
3. **Private interaction** — Bluetooth polls/feedback from attendees.

**The key architectural insight — the admin choice point:**
When the connection returns, the Station syncs to VI. The admin then *chooses*: keep the local Whisper transcript, or re-process the WAV through ElevenLabs (spending tokens) for higher quality. This means:
- Whisper is the **primary** local pipeline, not a fallback
- ElevenLabs is an **optional upgrade path**, not a dependency
- The privacy guarantee becomes tangible: audio stays private until the admin explicitly decides otherwise

**How this reshapes the job queue:**
- J2 (Pi provisioning): unchanged
- J3 (component platform): more important than ever — Whisper, Bluetooth, AI processing are all components
- J5: local Whisper STT as the primary pipeline, post-session batch first, live streaming later
- J6: cloud upgrade path — admin UI on apm side, re-submit WAV to ElevenLabs on demand
- J7: Bluetooth interaction component
- J8: local AI summarisation (Ollama)

**NeuTTS decision:** not adding it. It is TTS not STT, and it doesn't add value to the current roadmap. The `neutts.com` URL given by hackathon organisers is flagged as not affiliated with Neuphonic (the real project is at `neuphonic.com` / `github.com/neuphonic/neutts`). Whisper addresses the actual gap (local STT) and is deeply on-thesis.

**Tagline still holds, stronger now:** *"The room keeps recording. Even when the internet doesn't."* — and now also: *"And it keeps transcribing. Privately."*

---

**J1 verified.** Independent check of the Codex output: full module structure present, `package.json` deps correct (dotenv/zod/pino/pino-pretty/vitest in, node-fetch correctly dropped for native fetch), `StationStateMachine` correct (all transitions, illegal ones throw, events emitted), dashboard + banner logic correct, loop closed (diary/project updated, 7 tests green, build clean). One cosmetic nit: dashboard transcript re-renders fully each poll instead of diffing — not a blocker. **The laptop mock demo is solid and is the guaranteed hackathon fallback.**

**Direction set by Biju:** Station should be a **generic platform**, not a voice product. Voice is component #1; video is planned as component #2; more to follow. This reframes the roadmap into two distinct next steps:

- **J2 (now active) — Pi provisioning / connectivity.** Pure infrastructure: get the actual Pi 5 reachable over LAN, provisioned (alsa-utils, Node 22, pm2), auto-starting, and confirmed capturing real M-305 audio. Split into a human-physical half (power/network/SSH/mic) and an LLM half (idempotent `provision-pi.sh` + deploy + verify over SSH). Real ElevenLabs folded in as the proof the voice component works on hardware, with mock STT as the fallback if the venue blocks the API.
- **J3 (queued, prompt written) — Generic multi-component platform.** Refactor `StationApp` (currently voice-coupled — `pair/start/stop`, session model, status shape, report all assume voice) into a **host** that runs pluggable `StationComponent`s. Voice moves into `src/components/voice/VoiceComponent.ts` wrapping the existing capture/relay (behaviourally identical, just rehomed). A dormant `VideoComponent` stub proves the seam. Config-driven via `ENABLED_COMPONENTS=voice`. Test-protected; the voice demo must never break. Recorded as a durable principle in `memory.md` §1a.

**Why J2 before J3:** provisioning is independent of the refactor and unblocks the “it runs on real hardware” story immediately; J3 is a careful internal refactor best done when not racing a venue clock. Either order is valid, but infrastructure-first gives the earliest tangible win.

**Architectural note for J3:** the network-resilience guarantee stays in the host (the aggregate OFFLINE_BUFFERING logic in `reconcileOperationalState`), generalised to fold over all components. Components only expose “buffering? / queued count.” Don’t scatter reconnection logic into components.

---

## 2026-06-13 (Codex build run) — Full mock-first MVP implemented

### What was built

The scaffolded three-file sketch was replaced with a modular MVP:

- `capture/` now contains `AudioSource` adapters (`mock`, `arecord`, `file`), `WavChunkWriter`, `MockTranscriptProvider`, and an isolated `ElevenLabsRealtimeProvider`.
- `relay/` now persists transcript segments and relay queue rows in SQLite, posts to ingest with idempotency headers, retries with backoff, and drains in sequence order.
- `control/` now serves the local dashboard, `/status`, `/events`, `/transcript`, `/report/:sessionId`, `/mock/ingest`, and `/simulate/*`.
- `state/` now provides a strict finite state machine, typed event bus, and health log persistence.
- `db/` now owns migrations and typed repositories for the seven-table schema.
- `report/` now generates session reports and renders a styled MeetPaper HTML article by default, with JSON still available through `Accept: application/json`.
- `hardware/` now defaults to a console controller and keeps GPIO dormant but safely isolated.
- `public/` now contains the vanilla dashboard for the mock-first demo story.
- `test/` now covers state transitions, queue ordering, idempotency, WAV writing, mock transcript output, and an API smoke flow.

### What is real vs mocked

- **Mock by default:** audio source, transcript provider, ingest receiver, dashboard demo flow.
- **Real but not live-verified yet:** `ARecordAudioSource`, SQLite persistence, relay retry logic, report generation, Fastify control surface.
- **Implemented from documented assumptions and intentionally isolated:** `ElevenLabsRealtimeProvider`.

### Assumptions and notable decisions

- The ElevenLabs realtime adapter assumes the current documented websocket endpoint, `xi-api-key` auth, `pcm_s16le` 16kHz mono audio, and JSON frames that distinguish partial/final transcripts through `is_final` or an equivalent final marker. This still needs live J2 verification on real Pi hardware.
- The report route now defaults to styled HTML because the demo close needs a readable editorial surface; JSON remains available for tooling and inspection.
- The dashboard remains mock-first and browser-mic-free. All capture still happens server-side.
- Queue flushes triggered manually by reconnect use an immediate drain path, while the background interval still honours backoff timing.

### Verification

- `bash scripts/preflight.sh` passed with warnings only for missing `.env` and missing dependencies before install.
- `npm run typecheck` passed.
- `npm test` passed.
- `npm run build` passed.

### Open issues after the build

- J2 still needs live Pi verification for `arecord`, the M-305 device string, and the real ElevenLabs websocket payload.
- J3 still needs the PHP/apm ingest receiver at `voice.apresmeet.com/ws/station/ingest`.
- J4 still needs remote pairing validation and token exchange.

## 2026-06-13 (later still) — Dashboard design reference wired in

**Concern raised:** the dashboard is the surface judges actually see, and an LLM building vanilla-JS UI as phase 6 of a 10-phase build tends to produce something correct but visually flat — weak hierarchy, an underwhelming offline banner.

**Fix:** copied the MeetPaper Station concept paper into the repo at `devops/design/meetpaper_station_concept.html` as an in-scope **visual reference** (Codex runs scoped to pi-station and may not reach the original at `apm/devops/design/`). Rewrote build-prompt §15 to (a) point at that file and instruct “match this design language, don’t reinvent it,” (b) sharpen the layout into live-strip / masthead / instrument-cluster status strip / nav-style controls / transcript / health log, (c) make the three state banners explicit emotional beats — the amber `OFFLINE — AUDIO SAFE` banner is the peak and must appear instantly. Also upgraded §14: the report now renders as a **styled MeetPaper HTML article** (not raw JSON) for the demo's closing beat, with JSON still available via `Accept: application/json`. Added `report/reportHtml.ts` to the structure.

The two surfaces worth a manual polish pass after the build are the dashboard and the report; the rest (capture/relay/queue) is covered by the vitest suite.

---

## 2026-06-13 (later) — Build plan upgraded to full mock-first MVP

### The change

The original scaffold (three flat files `src/capture.ts`, `src/relay.ts`, `src/control.ts`) was a thin first sketch aimed at a Pi-first smoke test. After review — including an external second opinion from ChatGPT — the build plan was **upgraded to a complete mock-first MVP** that runs end-to-end on a laptop with **no microphone, no ElevenLabs key, no Pi, and no cloud endpoint.**

**Why this matters more than the Pi-first plan:** a hackathon demo cannot depend on live hardware, live credentials, or venue Wi-Fi — the very things that fail. By making mock mode first-class and driving the whole network-drop story from in-app `/simulate/*` endpoints, the demo is bulletproof and reproducible, and the real adapters (arecord, ElevenLabs, ApresMeet ingest) slot in behind interfaces without ever breaking mock mode.

### Decisions locked

- **Mock-first architecture.** `AudioSource`, `TranscriptProvider`, `HardwareController`, ingest are all interfaces with a mock default and a real implementation selected by env var. Mock mode is the demo path and must never be broken.
- **Finite state machine** drives both dashboard and (dormant) hardware: IDLE / PAIRING / READY / RECORDING / OFFLINE_BUFFERING / SYNCING / PAUSED / STOPPING / REPORT_READY / ERROR.
- **`/simulate/network/{down,up}` and `/simulate/stt/{drop,reconnect}`** are the engine of the demo — the amber "OFFLINE — AUDIO SAFE" moment is triggered from the dashboard, no real network manipulation needed.
- **Local dashboard** in vanilla HTML/CSS/JS using the real MeetPaper design tokens (DM Serif Display masthead, burgundy `#7A1F2B`, teal `#00C49A`, amber `#F5A623`). No React.
- **Richer data model** — 7 SQLite tables (sessions, transcript_segments, relay_queue, audio_chunks, session_events, insight_marks, station_config) instead of the original single queue table.
- **WAV header repair on startup** — proves audio survives a crash, not just a network drop.
- **Insight marks** — a "Mark Insight" button bookmarks ±30s with transcript excerpt; gives the demo a tangible artefact and a clean hook to MeetPaper's editorial layer.
- **Report on stop** — `data/reports/<id>.json` served at `/report/:id`, with a disabled `summariseWithLLM()` hook for later.
- **`vitest` test suite** — state machine, queue ordering, idempotency, WAV writer, mock transcript, API smoke. All run without hardware.

### Superseded

The flat `src/capture.ts`, `src/relay.ts`, `src/control.ts` from the morning scaffold are **superseded** by the modular `capture/ relay/ control/ state/ db/ report/ hardware/` structure in the build prompt. A fresh build run replaces them. Everything else from the scaffold stands (package.json baseline, tsconfig extending f365 base, .claude full-auth, CLAUDE.md, devops/ai/*, deploy-pi.sh, device-config.md).

### The single-shot build prompt

`devops/ai/prompts/PI_STATION_J1_full_mvp_build.md` is a complete, self-contained build brief — every module, the data model, the API contract, the dashboard spec, the test list, the build order, and the acceptance criteria. Designed to be executed in one continuous run by GPT-5 Codex (hackathon token budget) or Claude Opus, in full-authorisation mode, with no approval prompts. `job.md` points at it, STATUS READY.

### Added dependencies (vs morning scaffold)

`dotenv`, `zod`, `pino`, `pino-pretty` (deps); `vitest`, `@vitest/coverage-v8` (devDeps). Plus `tsx` already present.

---

## 2026-06-13 (morning) — Hackathon day, initial scaffold (Agents in the Wild, Blue Garage Lewisham)

### Context

One Raspberry Pi 5 (4GB) borrowed for the day. Mini USB Mic M-305 available. Hackathon theme: hardware + AI. Project conceived in conversation with Claude (claude.ai) as the MeetPaper Station — a physical local ingestion server for MeetPaper Voice Intelligence.

### What was decided

**Project rationale:** MeetPaper's Voice Intelligence already handles resilience via a 24h interruption window and server-side recovery. But all of that is *recovery after failure*. The Pi gives us *prevention* — by moving audio capture off the browser entirely, a Wi-Fi drop at the venue no longer interrupts the session.

**Where it lives:** Standalone project at `/Users/bijumenon/Sites/pi-station`, added as a third folder in `foundry365.code-workspace`. Not an npm workspace member of f365 — avoids Pi-specific native modules (`better-sqlite3`, `arecord` bindings) polluting the Mac dev environment. Shares `tsconfig.base.json` from f365 for TypeScript config only.

**Not inside the `apm` repo:** apm is PHP + jQuery deployed to Elastic Beanstalk. Pi deploys via rsync + pm2 over SSH. Completely different deployment targets — mixing them would require careful `.ebignore` maintenance forever and risk pushing Node modules to EB.

### Hardware confirmed available

- Raspberry Pi 5 (4GB) × 2 units (one in box, one bare board)
- Mini USB Microphone M-305 (USB class-compliant, plug-and-play, no driver needed)
- MicroSD card
- No USB-C power bank on hand today — single point of failure for power

---

## 2026-06-21 — J2 Pi provisioning complete

### What was done

- Re-flashed microSD via Raspberry Pi Imager with correct hostname (`pistation`), username (`pistation`), Wi-Fi (iPhone hotspot SSID `2703369`), SSH enabled
- Diagnosed mDNS failure: hostname was `pistation.local` not `pi-station.local`; user was `pistation` not `pi`. Discovered by mounting SD on Mac and reading `/Volumes/bootfs/network-config` + `user-data`
- Set up SSH key auth (`~/.ssh/pi_station_key`, ed25519) via `expect` (no sshpass/brew on Mac)
- Added `Host pistation.local` to `~/.ssh/config`
- Ran `scripts/provision-pi.sh`: installed sqlite3, python3-venv, Node 22 via fnm, pm2
- Updated `shared/src/PlatformConfig.ts` and `core/src/config.ts` to add `faster-whisper` as STT provider option
- Created `scripts/transcribe.py` (faster-whisper batch transcription)
- Updated `scripts/deploy-pi.sh`: changed user to `pistation`, build on Mac not Pi (Pi lacks f365 tsconfig.base.json), rsync dist/ included
- Deployed app to Pi: pm2 started `apps/meet-station/dist/index.js`, status API returning `{"ok":true}`
- Configured pm2 auto-start via systemd (`pm2-pistation.service`)
- Installed faster-whisper in `/home/pistation/pi-station/venv-whisper`, downloaded `base.en` model (142MB)
- **Confirmed audio device:** M-305 appears as `card 2: Device [USB PnP Sound Device]` → `AUDIO_DEVICE=plughw:2,0`
- **Confirmed real recording:** 8s session wrote `chunk-000001.wav` (251KB)
- **Confirmed faster-whisper transcription:** real speech from M-305 transcribed to 4 segments with word-level timestamps

### Key deviations from the plan

- Username/hostname in Imager was `pistation` not `pi`/`pi-station` — caused mDNS failure. Fixed by reading boot partition.
- Build must happen on Mac, not Pi — Pi doesn't have `../f365/tsconfig.base.json`. Deploy script updated to rsync `dist/`.
- Audio card index is **2**, not the assumed **1** — M-305 appeared as card 2 on this Pi.

---

## 2026-06-21 — J3 Generic multi-component platform

### Architectural decision

MeetPaper Station was previously a voice-only hardcode — `MeetStationApp` directly held `CaptureService` and `RelayService` and the reconciliation logic assumed a single voice pipeline. J3 turns it into a **generic local capture platform** that hosts one or more independent `StationComponent` instances.

**Why the boundary sits here:** The host owns session lifecycle (pair/start/pause/resume/stop), the state machine, the database, the API server, the network-resilience guarantee (OFFLINE_BUFFERING = any component buffering), and hardware. Components own their capture source, local buffer, cloud relay, and their contribution to the report. This is the minimal boundary that lets voice and video (and future components) coexist without the host knowing their internals.

### What was built

- **`StationComponent` interface** (`apps/meet-station/src/components/StationComponent.ts`): `init`, `startSession`, `pause`, `resume`, `stopSession`, `flush`, `getStatus`, `contributeToReport`, `shutdown`
- **`ComponentContext`**: config, repositories, bus, logger, dataDir — everything a component needs
- **`ComponentStatus`**: id, label, healthy, buffering, queuedItems, detail — what the host reads to drive the state machine
- **`VoiceComponent`** (`components/voice/VoiceComponent.ts`): wraps existing `CaptureService` + `RelayService`. Exposes `setReconcileCallback` so the host can register a trigger for `reconcileOperationalState`. Voice logic is byte-for-byte behaviourally identical — just relocated.
- **`VideoComponent` stub** (`components/video/VideoComponent.ts`): registers, reports healthy, writes nothing. Proves the seam holds.
- **Component registry** (`components/registry.ts`): `buildComponentRegistry(ids, voiceInstance)` — unknown ids fail loudly at startup.
- **`ENABLED_COMPONENTS`** env var (default `voice`): `ENABLED_COMPONENTS=voice,video` boots with dormant video card.
- **`MeetStationApp` refactored** into a host: constructor takes `StationComponent[]`. Fan-out on all lifecycle calls. `reconcileOperationalState` folds over `components[].getStatus().buffering`.
- **`/status`** gains `components: ComponentStatusSummary[]` array. Back-compat `mic`/`stt`/`relay`/`buffer` fields still populated from VoiceComponent — marked deprecated.
- **Dashboard** gains a Components row: one card per component showing healthy/buffering/queued count. Voice card shows mic/stt/queue; video card shows stub note.
- **2 new test files**: `componentHost.test.ts` (11 tests: registry, VideoComponent lifecycle, fan-out), `aggregateState.test.ts` (17 tests: pure aggregate logic for one and two components, all guarded states).
- **`docs/COMPONENTS.md`**: how to add a component.

### Numbers

- Tests: **35/35 green** (8 files, up from 33/33)
- New component files: 5
- `MeetStationApp.ts`: completely rewritten as host — same external API, no breaking changes to routes
- Typecheck: clean
- Build: clean

### Key design choices

- VoiceComponent gets its `CaptureService` and `RelayService` pre-constructed and injected (simpler than building them inside). `index.ts` is the composition root.
- `reconcileOperationalState` is still on the host (host owns the state machine), not distributed across components.
- The relay `onQueueBacklog`/`onQueueDrained` callbacks remain no-ops; reconciliation is triggered by bus events via `setReconcileCallback`.
- Back-compat status fields (`mic`, `stt`, `relay`, `buffer`) populated via `VoiceComponent.getCaptureService()` / `getRelayService()` — duck-typed, no circular dep.

---

## 2026-06-21 — J3b Sync Service (offline → online via S3)

### Architectural decision

Added the host-level `SyncService` that moves a session to the cloud in four gated phases when the network returns. The central rule from the ecosystem: **large binaries go straight to S3 via presigned URLs, never through PHP/Elastic Beanstalk.** The Pi holds no AWS credentials — it only exchanges tiny JSON coordination requests (manifest / presign / confirm / sync-complete) and PUTs bytes directly to presigned S3 URLs.

**Why sync lives in `core/`, not the app:** the sync_state + media_transfer_queue tables, the orchestration, and the connectivity probe are platform capabilities any future edge app inherits. SyncService depends only on repositories + an HTTP client + an uploader — it reads audio chunks from the `audioChunks` repo and the relay queue depth directly, so it is decoupled from the meet-station app's RelayService. The app wires it together in `index.ts` (composition root) and passes it into the host.

### What was built

- **Two new tables** (`core/src/db/migrations.ts`): `sync_state` (per-phase status) + `media_transfer_queue` (resumable per-chunk upload state, UNIQUE on session+type+chunk).
- **Repositories**: `SyncStateRepository`, `MediaTransferRepository`; added `relayQueue.countBySession`.
- **`StationSyncClient`** (`core/src/sync/`): interface + `HttpStationSyncClient` — manifest / presign / confirm / sync-complete. Treats 409 as idempotent "existing".
- **`MediaUploader`**: resumable S3 multipart via presigned URLs. The S3 upload_id is the resume token; confirmed parts persist in `parts_json`. On re-run it requests presigned URLs only for parts with `part_number > max confirmed`. Plain `fetch` PUT to presigned URLs (no SDK auth on the Pi). Injectable `httpPut` for tests.
- **`ConnectivityProbe`**: polls a health endpoint; emits `online`/`offline` **only on transitions** (no repeat firing for sustained state). Injectable `healthCheck` for tests.
- **`SyncService`**: four-phase orchestrator. Phase gating: manifest → segments (relay depth 0) → media (audio now, video seam for J6) → complete. `runSyncCycle` (resumes from failed phase), `syncOnStop` (best-effort at stop), `getSyncStatus` (dashboard).
- **Mock station + mock S3 routes** (`apps/meet-station/src/control/mockStationRoutes.ts`): the Pi hosts the apm endpoints itself at `/mock/station/*` and a mock S3 PUT at `/mock/s3/upload`. All honour the simulated-network flag, so `/simulate/network/down` breaks sync like a real outage. Added an `application/octet-stream` body parser for the binary PUT.
- **Host wiring**: `MeetStationApp` gained optional `syncService` + `connectivityProbe`. `stop()` runs `syncOnStop` before report; `simulateNetworkUp` triggers `runSyncCycle`; the probe starts on entering OFFLINE_BUFFERING and stops on leaving; `online` → run cycle. `/status` gained a `sync` field.
- **Dashboard**: a "Sync to Cloud" section renders per-phase progress including per-chunk audio/video status (✓ / ↻ / ○ / —).
- **AWS SDK deps** added to `core/package.json` (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) per the spec; not yet imported (presigned-URL fetch path needs no SDK auth on the Pi) — kept for the forward S3-side path.
- **`docs/SYNC.md`**: the four phases, resumability, S3 layout, mock mode, and the precise J4 endpoint contracts + `VI_MEDIA_ASSETS` table.

### Tests (13 files, 48 green; +6 files, +13 tests this job)

- `connectivityProbe.test.ts` (6): online/offline fire once per transition; flapping; thrown check = offline.
- `syncResumable.test.ts`: drop after part 1 → resume requests only `from_part=2`, reuses upload_id, finishes & confirms.
- `manifestIdempotent.test.ts`: first 200 existing=false, second 409 existing=true; 503 when network down.
- `syncPhases.test.ts` (3): manifest failure halts before phase 2; pending segment halts before phase 3; clean run = all four in order.
- `syncE2E.test.ts`: full path through the real server + mock S3 — on stop, manifest confirmed, segments synced, audio chunks uploaded, sync_complete true.

### Key choices / deviations

- Audio `fileSize` = chunk bytes + 44 (WAV header) when enqueuing media.
- `mediaTransfer` enqueue is idempotent (INSERT OR IGNORE) — re-running phase 3 never duplicates rows.
- Media phase marks a type `skipped` when there are no chunks of that type (video today), so the phase never blocks.
- SyncService is in `core/` (exported) replacing the J3b placeholder stub.

---

## Open issues

| # | Issue | Status |
|---|---|---|
| 1 | arecord device string confirmation on Pi (`arecord -l`) | ✅ Confirmed: `plughw:2,0` (card 2) |
| 2 | ElevenLabs Scribe v2 WS API format verification | ⏳ pending — mock provider works |
| 3 | apm-side station endpoints (manifest/presign/confirm/sync-complete + ingest) | ⏳ not built (J4) — mock station + mock S3 cover demo; contracts specced in `docs/SYNC.md` |
| 4 | Session pairing server-side validation (`PAIRING_MODE=remote`) | ⏳ not built (J4) — local pairing works for demo |
| 7 | AWS SDK deps added but unused (presigned-URL fetch path needs no SDK) | ℹ️ intentional — kept for forward S3-side work |
| 5 | pm2 / systemd startup hook on Pi | ✅ Configured (`pm2-pistation.service`) |
| 6 | USB-C power-bank UPS (no battery backup on hand) | ⏳ to acquire — not blocking demo |
