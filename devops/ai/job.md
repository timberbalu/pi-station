# job.md — current job pointer

> Holds the ONE current job. To run it: *"study devops/ai/START_HERE.md, then devops/ai/diary.md and devops/ai/memory.md, then do the job in devops/ai/job.md."* When finished: set STATUS to DONE, append a run report to `devops/ai/project.md`, point to next job.

---

STATUS: READY

**Prompt:** `devops/ai/prompts/PI_STATION_J1_full_mvp_build.md`

**Job:** Build the complete MeetPaper Station MVP in a single continuous run — mock-first, demo-ready, no hardware or credentials required to run.

**Run in full-authorisation mode.** `.claude/settings.json` + `CLAUDE.md` pre-authorise every operation. The LLM must not pause to ask for approval. Make sensible assumptions, document them, keep building.

**Recommended model/provider:** GPT-5 Codex (hackathon token budget) or Claude Opus. This is a large multi-module build — capability matters; it cannot be cheaply rebuilt.

---

### What this builds (one pass)

A complete, runnable MeetPaper Station: a Raspberry Pi 5 local audio-ingestion server for ApresMeet Voice Intelligence. The Pi is the sole capture point; the browser is a control surface only.

**The one invariant:** recording survives a network drop. Cloud unreachable → audio keeps writing to disk, segments queue in SQLite, queue flushes gaplessly on reconnect.

**Modules:**
- `capture/` — AudioSource (mock / arecord / file replay), WavChunkWriter (rolling 30s, header repair on startup), TranscriptProvider (mock / ElevenLabs Scribe v2)
- `relay/` — SQLite queue, chronological idempotent flush, exponential backoff
- `control/` — Fastify API (`/status /pair /start /pause /resume /stop /mark` + `/simulate/*` fault injection + `/mock/ingest`)
- `state/` — StationStateMachine (IDLE…RECORDING…OFFLINE_BUFFERING…SYNCING…REPORT_READY), event bus, health log
- `db/` — better-sqlite3, TS migrations, typed repositories (7 tables)
- `report/` — report JSON on stop, served at `/report/:id`
- `public/` — MeetPaper-styled vanilla-JS dashboard (real meetpaper.css tokens)
- `hardware/` — console controller (default) + dormant GPIO controller
- `test/` — vitest: state machine, queue ordering, idempotency, WAV writer, mock transcript, API smoke
- `docs/`, `systemd/`, `scripts/` — Pi setup, demo script, architecture, audio check

**The decisive constraint:** the entire demo runs in mock mode with no microphone, no ElevenLabs key, no Pi, no cloud. Mock mode is first-class and must never be broken by the real adapters.

---

### Gate (acceptance — all must hold)

1. `npm run dev` runs in mock mode with no hardware/credentials
2. Dashboard at `http://localhost:3456`
3. Pair → Start → mock transcript appears → WAV chunks written
4. Simulate network down → queue grows, state OFFLINE_BUFFERING, amber "OFFLINE — AUDIO SAFE" banner
5. Reconnect → SYNCING → queue flushes to zero in order → RECORDING
6. Mark Insight stored; Stop → report opens, gapless
7. `npm test` green, `npm run build` clean
8. No secrets committed

---

### Reconcile, don't overwrite

The repo is already scaffolded (package.json, tsconfig extending ../f365 base, .env.example, .claude/settings.json, CLAUDE.md, devops/ai/*, scripts/deploy-pi.sh, devops/hardware/device-config.md). The three flat files `src/capture.ts` / `src/relay.ts` / `src/control.ts` are a first sketch — replace them with the richer modular structure in the prompt (§2, §4). Keep everything else; add deps (`dotenv`, `zod`, `pino`, `pino-pretty`, `vitest`).

---

### After J1 (next jobs)

- **J2 — ElevenLabs live on Pi:** real `ELEVENLABS_API_KEY`, confirm Scribe v2 WS wire format, first physical capture with the M-305 mic. Confirm `arecord -l` device string and update `AUDIO_DEVICE`.
- **J3 — apm receiver endpoint:** build `voice.apresmeet.com/ws/station/ingest` on the PHP/apm side to receive segment POSTs. Bearer auth tied to `session_code`; write to `VI_TRANSCRIPT_SEGMENTS`.
- **J4 — remote pairing:** `POST /pair` in `PAIRING_MODE=remote` validates against `voice.apresmeet.com/ws/station/pair`, returns `session_id` + short-lived `station_token`.
