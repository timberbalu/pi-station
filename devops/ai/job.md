# job.md — current job pointer

> Holds the ONE current job. To run it: *"study devops/ai/START_HERE.md, then devops/ai/diary.md and devops/ai/memory.md, then do the job in devops/ai/job.md."* When finished: set STATUS to DONE, append a run report to `devops/ai/project.md`, point to next job.

---

STATUS: DONE

**Prompt:** `devops/ai/prompts/PI_STATION_J2_pi_provisioning.md`

**Job:** Provision the Raspberry Pi 5, deploy MeetStation, confirm real M-305 audio capture and faster-whisper transcription.

**Completed:** 2026-06-21

---

## Previous job (J2b — complete)

**Prompt:** `devops/ai/prompts/PI_STATION_J2b_platform_restructure.md`

**Job:** Restructure the codebase from a single-app project into a proper platform. Pi-Station is the platform (the F365 of edge hardware). MeetStation is the first app. Four npm workspaces: `shared` (PiApp interface), `core` (DB, state, config, logger), `hardware` (servo/camera stubs), `apps/meet-station` (everything built in J1, renamed). Pure structural refactor — zero logic changes, all 7 tests must still pass, mock demo must run identically after.

**Run in full-authorisation mode.** No approval prompts needed.

**Recommended model:** Claude Opus or GPT-5 Codex.

**This is a move/rename refactor, not a rewrite.** The prime directive: `npm test` stays green and the mock demo runs identically at every intermediate step.

---

### Gate (acceptance — all must hold)

1. `shared/`, `core/`, `hardware/`, `apps/meet-station/` exist as npm workspaces
2. `PiApp` interface in `shared/src/PiApp.ts`
3. `MeetStationApp` class in `apps/meet-station/src/MeetStationApp.ts`
4. `hardware/` has stub `PanTiltController` + `CameraController`
5. `npm run typecheck` clean across all workspaces
6. `npm test` — 7 tests green
7. `npm run dev` — full mock demo unchanged from J1
8. Old `src/` directory removed
9. `CLAUDE.md` + `README.md` updated to reflect platform architecture

---

### Done — J1 (complete, verified 2026-06-13)

J1 built the full mock-first MVP in `src/`. All tests green, build clean, mock demo runs end to end.

---

### Next job

- **J3 — Component platform** (`prompts/PI_STATION_J3_component_platform.md`): refactor MeetStationApp into a host that runs pluggable StationComponents. Voice becomes VoiceComponent; dormant VideoComponent stub added.

### Remaining queued jobs

- **J3 — Component platform** (`prompts/PI_STATION_J3_component_platform.md`): refactor MeetStationApp into a host that runs pluggable components. Voice becomes VoiceComponent; dormant VideoComponent stub.
- **J3b — Sync Service** (`prompts/PI_STATION_J3b_sync_service.md`): phased offline→online sync via S3 presigned URLs. Resumable. No data loss.
- **J4 — apm ingest receiver**: manifest + segment + media + sync-complete on PHP/apm side.
- **J5 — Local STT (faster-whisper)**: post-session batch transcription; local transcript; cloud upgrade flag.
- **J6 — VideoComponent + pan/tilt**: libcamera, rolling MP4, AI HAT+ face detection, PCA9685 servo tracking.
- **J7 — Cloud upgrade path**: admin re-submits WAV to ElevenLabs; replaces local transcript in VI.

**Dropped:** Ollama, NeuTTS, Vosk (reasons in diary and memory.md).
