# PI_STATION_J1 — Build the complete MeetPaper Station MVP

> **This is a single-shot, full-build prompt.** Execute the entire implementation in one continuous run. Do not stop to ask for approval — this repository is in full-authorisation mode (`.claude/settings.json` and `CLAUDE.md` pre-authorise every operation you need). Make sensible assumptions, document them, and keep going. There is no second pass for scaffolding; build it complete, runnable, and demo-ready the first time.
>
> **Read before starting:** `devops/ai/START_HERE.md`, `devops/ai/diary.md`, `devops/ai/memory.md`, `CLAUDE.md`. They carry the product boundary, the one invariant, the stack, and the conventions. If anything here contradicts START_HERE, flag it and follow START_HERE.
>
> **Recommended model:** GPT-5 Codex or Claude Opus — this is a large, multi-module build; spend the capability here, it cannot be rebuilt.

---

## 0. The mission in one paragraph

Build the first complete, runnable MVP of **MeetPaper Station** — a Raspberry Pi 5 local audio-ingestion server for ApresMeet Voice Intelligence. It sits physically in the room at an event and guarantees local audio capture even when the organiser's browser closes, the laptop dies, or the venue Wi-Fi drops. The Pi is the sole capture point; the browser is only a control surface. The tagline, which the whole demo must prove true:

> **The room keeps recording. Even when the internet doesn't.**

The single invariant that must never break: **recording survives a network drop.** If the cloud is unreachable, audio keeps being written to disk, transcript segments queue locally in SQLite, and the queue flushes in chronological order when connectivity returns — gaplessly.

---

## 1. Hard constraints (non-negotiable)

1. **Mock mode is first-class.** The entire demo must run on a laptop with **no microphone, no ElevenLabs key, no Raspberry Pi, no GPIO, and no ApresMeet cloud endpoint.** This is the most important constraint in the whole build. A judge must be able to clone, `npm install`, `npm run dev`, open a browser, and see the full story in 90 seconds.
2. **Never break mock mode** while adding the real Pi/ElevenLabs/cloud adapters. Real adapters are alternative implementations behind interfaces, selected by env var. Mock is always the default.
3. **The browser never touches the microphone.** All audio capture is server-side on the Pi. The dashboard is a control surface and display only — it polls the local API.
4. **Recording must never stop because a cloud service failed.** STT disconnect, relay failure, ingest 503 — none of these may halt audio capture or crash the server. Degrade to a safe state, expose diagnostics, keep the WAV buffer writing.
5. **No secrets in the repo.** `ELEVENLABS_API_KEY` is server-side only and must never reach the dashboard JavaScript. `.env` is gitignored; only `.env.example` is committed.
6. **TypeScript strict, ESM, no `any`.** Local imports use `.js` extensions (NodeNext). Use `unknown` + narrowing. Validate all request bodies with `zod`.
7. **This is standalone.** Do not import from `../f365` at runtime. `tsconfig.json` extends `../f365/tsconfig.base.json` for compiler config only. No PHP, no MySQL, no PostgreSQL, no Docker dependency.

---

## 2. Reconcile with what already exists

The repo is already scaffolded. **You must reconcile, not blindly overwrite.** Existing files:

```
pi-station/
├── package.json          ← has deps: fastify, better-sqlite3, ws, node-fetch + dev: tsx, typescript, @types
├── tsconfig.json         ← extends ../f365/tsconfig.base.json — keep this
├── .env.example          ← REPLACE with the fuller version in §5
├── .gitignore            ← keep; ensure data/ buffer/ *.sqlite *.db .env are ignored
├── README.md             ← REPLACE with the fuller version in §19
├── CLAUDE.md             ← keep — operating manual
├── .claude/settings.json ← keep — full-auth permissions
├── src/
│   ├── config.ts         ← EXPAND into the full typed config in §5
│   ├── capture.ts        ← SUPERSEDED — replace with the capture/ module in §9
│   ├── relay.ts          ← SUPERSEDED — replace with the relay/ module in §12
│   ├── control.ts        ← SUPERSEDED — replace with the control/ module in §7
│   └── index.ts          ← EXPAND into the full bootstrap in §6
├── scripts/
│   └── deploy-pi.sh      ← keep; the rsync+pm2 deploy still applies
└── devops/
    ├── ai/               ← keep all — START_HERE, diary, memory, job, project, ideas, prompts
    └── hardware/
        └── device-config.md  ← keep — arecord device string notes
```

The three flat files `src/capture.ts`, `src/relay.ts`, `src/control.ts` were a first sketch. Replace them with the richer modular structure below. **Add `dotenv`, `zod`, `pino`, `pino-pretty` to `package.json` dependencies, and `vitest` + `@vitest/coverage-v8` to devDependencies.** Add `"test": "vitest run"`, `"test:watch": "vitest"` to scripts.

After the build, update `package.json`, `devops/ai/diary.md`, `devops/ai/project.md`, and `devops/ai/job.md` per §26.

---

## 3. Technology choices

**Use:** Node.js ≥ 22 · TypeScript strict · Fastify · `better-sqlite3` · `ws` · `zod` · `pino` (+`pino-pretty` for dev) · `dotenv` · `crypto.randomUUID` · `tsx` (dev) · `vitest` (tests) · plain HTML/CSS/vanilla JS for the dashboard.

**Avoid:** React, Next.js, any frontend framework, Docker as a hard dependency, any cloud DB, OAuth, Stripe, browser microphone APIs, heavyweight queue libraries.

---

## 4. Target directory structure

Build this structure under `pi-station/`:

```
src/
  index.ts                      entry point — boots everything, graceful shutdown
  config.ts                     typed env config (zod-validated, as const shape)
  logger.ts                     pino logger
  types.ts                      shared domain types

  control/
    server.ts                   Fastify app factory (buildServer) — testable
    routes.ts                   control + status + transcript + report routes
    simulateRoutes.ts           /simulate/* network + stt fault injection
    mockIngestRoutes.ts         /mock/ingest + /mock/ingest/segments
    dashboardRoutes.ts          serves /public static dashboard

  capture/
    CaptureService.ts           orchestrates audio source + STT + WAV writer
    AudioSource.ts              interface
    MockAudioSource.ts          default — fake PCM on interval, no mic needed
    ARecordAudioSource.ts       Pi — spawn arecord, read PCM from stdout
    FileReplayAudioSource.ts    replay a WAV file (repeatable tests/demo)
    WavChunkWriter.ts           rolling 30s WAV chunks, header repair on startup
    TranscriptProvider.ts       interface
    MockTranscriptProvider.ts   default — emits segments from fixture
    ElevenLabsRealtimeProvider.ts  real Scribe v2 WS adapter, isolated

  relay/
    RelayService.ts             enqueue + flush loop, chronological, idempotent
    IngestClient.ts             POST to VOICE_INGEST_URL with backoff
    QueueRepository.ts          relay_queue CRUD

  db/
    Database.ts                 better-sqlite3 open + pragma
    migrations.ts               TS migrations, auto-run on startup
    repositories.ts             typed repos for every table

  state/
    StationStateMachine.ts      finite state machine (§6 states)
    StationEventBus.ts          in-process EventEmitter, typed events
    HealthLog.ts                writes session_events rows

  hardware/
    HardwareController.ts       interface
    ConsoleHardwareController.ts  default — logs + sets dashboard state
    GpioHardwareController.ts   optional, ENABLE_GPIO=true, fails safe to console

  report/
    ReportGenerator.ts          builds report JSON on stop; summariseWithLLM() hook (disabled)
    reportHtml.ts               renders the styled MeetPaper HTML report page from report JSON

  public/
    index.html                  MeetPaper-styled dashboard
    styles.css                  uses the real MeetPaper tokens (§15)
    app.js                      vanilla JS polling /status /events /transcript

fixtures/
  mock-panel-transcript.txt     scripted panel lines for the demo

(reference, already in repo — do not rebuild)
  devops/design/meetpaper_station_concept.html   visual reference for the dashboard + report

test/
  stateMachine.test.ts
  queueOrdering.test.ts
  idempotency.test.ts
  wavWriter.test.ts
  mockTranscript.test.ts
  api.smoke.test.ts

vitest.config.ts
systemd/
  meetpaper-station.service
docs/
  ARCHITECTURE.md
  DEMO_SCRIPT.md
  PI_SETUP.md
```

---

## 5. Environment config — `src/config.ts` + `.env.example`

Replace `.env.example` with this, and make `config.ts` load `.env` via `dotenv`, validate with `zod`, and export a typed frozen `config` object. Fail fast with a clear message if a required var is malformed.

```bash
# Core
NODE_ENV=development
PORT=3456
HOST=0.0.0.0
STATION_ID=MPS-001
STATION_NAME=MeetPaper Station 001
DATA_DIR=./data
SQLITE_PATH=./data/station.sqlite
AUDIO_DIR=./data/audio

# Audio
AUDIO_SOURCE=mock            # mock | arecord | file
AUDIO_DEVICE=plughw:1,0      # Pi: confirm with `arecord -l` (M-305 mini USB mic)
AUDIO_SAMPLE_RATE=16000
AUDIO_CHANNELS=1
AUDIO_CHUNK_SECONDS=30
AUDIO_FILE_PATH=

# Speech-to-text
STT_PROVIDER=mock            # mock | elevenlabs
ELEVENLABS_API_KEY=
ELEVENLABS_MODEL_ID=scribe_v2_realtime
ELEVENLABS_LANGUAGE_CODE=en
ELEVENLABS_INCLUDE_TIMESTAMPS=true

# ApresMeet / Voice Intelligence ingest
VOICE_INGEST_URL=http://localhost:3456/mock/ingest
VOICE_INGEST_TOKEN=dev-token
VOICE_INGEST_TIMEOUT_MS=5000

# Pairing
PAIRING_MODE=local           # local | remote
STATION_PAIRING_URL=
STATION_PAIRING_TOKEN=

# Relay behaviour
RELAY_FLUSH_INTERVAL_MS=2000
RELAY_MAX_ATTEMPTS=50
RELAY_INITIAL_BACKOFF_MS=1000
RELAY_MAX_BACKOFF_MS=30000

# Demo simulation
ENABLE_MOCK_INGEST=true
MOCK_INGEST_AVAILABLE=true

# Hardware
ENABLE_GPIO=false
GPIO_CHIP=gpiochip0
GPIO_RED_PIN=17
GPIO_TEAL_PIN=27
GPIO_AMBER_PIN=22
GPIO_WHITE_PIN=24
GPIO_BUTTON_PIN=23
```

Never commit a real key. Never expose `ELEVENLABS_API_KEY` to the dashboard.

---

## 6. Bootstrap + state machine — `src/index.ts` + `state/`

`index.ts` loads config, opens the DB, runs migrations, constructs the event bus, state machine, health log, hardware controller, capture service, relay service, and the Fastify server, then listens. On `SIGINT`/`SIGTERM`: stop accepting work, close the open WAV chunk, flush the queue best-effort, close the DB, exit cleanly. Never leave a half-written WAV header.

**StationStateMachine** — these states and their UI/hardware mappings:

```
IDLE               no session                         white idle
PAIRING            binding to a VI session code       white pulse
READY              paired, ready to record            white solid
RECORDING          capturing + relay healthy          red recording + teal delivery
OFFLINE_BUFFERING  capturing, relay/STT degraded,     amber
                   local data safe
SYNCING            network back, queue flushing        teal pulse
PAUSED             organiser paused capture            white/amber
STOPPING           flushing + closing WAV chunks       amber pulse
REPORT_READY       ended, local report available       teal solid
ERROR              something failed; stay alive        red blink
```

Enforce legal transitions; reject illegal ones with a clear error rather than corrupting state. The transition `RECORDING → OFFLINE_BUFFERING` is driven by relay/STT health, and `OFFLINE_BUFFERING → SYNCING → RECORDING` by the queue draining to zero. Emit a typed event on every transition; HealthLog persists it.

---

## 7. Local API contract — `control/`

Fastify on `PORT` (default 3456). Implement:

```
GET  /                      dashboard (static)
GET  /status                full status object (below)
GET  /health                { ok: true, version }
GET  /events?limit=50       recent session_events
GET  /transcript            committed segments for current session, in order
GET  /report/:sessionId     report JSON

POST /pair                  { session_code, title? }
POST /start
POST /pause
POST /resume
POST /stop
POST /mark                  { note? } — bookmark current time ±30s

POST /simulate/network/down
POST /simulate/network/up
POST /simulate/stt/drop
POST /simulate/stt/reconnect
```

`GET /status` returns exactly this shape (fill live values):

```json
{
  "station_id": "MPS-001",
  "station_name": "MeetPaper Station 001",
  "version": "0.1.0",
  "state": "OFFLINE_BUFFERING",
  "session": {
    "session_id": "VI-2026-06-13-001",
    "session_code": "482913",
    "title": "Founder Fundraising Panel",
    "started_at": "2026-06-13T18:02:11.000Z",
    "elapsed_ms": 2538000
  },
  "recording": true,
  "mic":   { "available": true, "source": "mock", "device": "default", "sample_rate": 16000, "channels": 1, "level_db": -18.4 },
  "stt":   { "provider": "mock", "connected": true, "last_partial_at": "...", "last_commit_at": "...", "committed_segments": 42 },
  "relay": { "ingest_url": "...", "connected": false, "queued_segments": 18, "sent_segments": 24, "dead_segments": 0, "last_flush_at": null, "last_error": "Mock ingest unavailable" },
  "buffer":{ "audio_chunks": 12, "seconds_safe": 360, "bytes": 11520000, "current_chunk_path": "./data/audio/VI-2026-06-13-001/chunk-000012.wav" },
  "hardware": { "enabled": false, "controller": "console", "last_state": "amber" },
  "last_events": []
}
```

`POST /pair` in `PAIRING_MODE=local` mints a session locally and returns `{ success, session_id, station_token }`. In `remote`, POST to `STATION_PAIRING_URL` and adopt the returned `session_id`, `station_token`, `ingest_url`. `POST /mark` records an `insight_marks` row at current elapsed time with a 30s-before / 30s-after window and, where possible, the transcript excerpt in that window. Validate every body with `zod`.

---

## 8. Database — `db/`

SQLite via `better-sqlite3`. TS migrations auto-run on startup. Enable WAL mode. Tables (use these exact columns):

- **`station_config`** — `key PK, value, updated_at`
- **`sessions`** — `id PK, session_code, title, state, station_token, ingest_url, started_at, stopped_at, created_at, updated_at`
- **`transcript_segments`** — `id PK, session_id, sequence, provider, start_ms, end_ms, text, speaker_label, language_code, confidence, raw_json, committed_at, created_at, UNIQUE(session_id, sequence)`
- **`relay_queue`** — `id PK, session_id, segment_id, sequence, payload_json, status, attempts DEFAULT 0, last_error, next_attempt_at, sent_at, created_at, updated_at, UNIQUE(session_id, segment_id)`; status ∈ `pending|sending|sent|dead`
- **`audio_chunks`** — `id PK, session_id, chunk_index, path, start_ms, end_ms, bytes DEFAULT 0, sample_rate, channels, status, created_at, closed_at, UNIQUE(session_id, chunk_index)`; status ∈ `open|closed|repaired|error`
- **`session_events`** — `id PK, session_id, type, level, message, payload_json, created_at`
- **`insight_marks`** — `id PK, session_id, at_ms, before_ms, after_ms, note, transcript_excerpt, created_at`

All ids are `crypto.randomUUID()` strings. All timestamps are ISO-8601 UTC strings. Typed repositories in `repositories.ts` — no raw SQL leaking into services.

---

## 9. Capture pipeline — `capture/`

`CaptureService` orchestrates: start the `AudioSource`; stream PCM to both the `WavChunkWriter` (always, unconditionally — this is the safety net) and the `TranscriptProvider` (best-effort); receive committed segments from the provider; persist them to `transcript_segments`; hand them to `RelayService`; emit events; maintain the `mic`/`stt`/`buffer` status metrics.

**`AudioSource` interface:**

```ts
export interface AudioChunk { pcm: Buffer; timestamp: Date; durationMs: number; levelDb?: number; }
export interface AudioSource {
  readonly name: string;
  start(onChunk: (chunk: AudioChunk) => void): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}
```

- **`MockAudioSource`** (default) — emits synthetic PCM on a timer; never needs a mic. Vary `levelDb` slightly so the dashboard meter moves.
- **`ARecordAudioSource`** (Pi) — `spawn('arecord', ['-D', device, '-f','S16_LE','-r',rate,'-c',channels,'-t','raw'])`, read PCM from stdout. Handle missing `arecord`, permission errors, device-not-found, child exit — move to a degraded/ERROR state and expose diagnostics; never crash the server.
- **`FileReplayAudioSource`** — replay a WAV/raw file for repeatable demos and tests.

**`WavChunkWriter`** — rolling chunks at `data/audio/<session_id>/chunk-000001.wav` … Default 30s. Correct 44-byte WAV header; on chunk close, rewrite the RIFF/`data` sizes. Record metadata in `audio_chunks`. **On startup, scan for `open` chunks and repair their headers** (compute sizes from file length), marking them `repaired`. This is the proof that audio survives a crash.

---

## 10. Transcript providers — `capture/`

```ts
export interface TranscriptProvider {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendAudio(chunk: AudioChunk): Promise<void>;
  onPartial(cb: (p: TranscriptPartial) => void): void;
  onCommit(cb: (s: TranscriptSegment) => void): void;
  isConnected(): boolean;
}
```

- **`MockTranscriptProvider`** (default) — read lines from `fixtures/mock-panel-transcript.txt`; every 2–4s emit a partial then a committed segment with incrementing `sequence`, plausible `start_ms`/`end_ms`, and a `speaker_label` parsed from the `Speaker: text` line prefix. The whole demo runs on this.
- **`ElevenLabsRealtimeProvider`** — real Scribe v2 over `ws`. API key server-side only. Connect to the realtime STT endpoint with `ELEVENLABS_MODEL_ID`; send audio in the wire format current ElevenLabs docs specify; parse partial vs committed frames; reconnect with exponential backoff; **if it disconnects, WAV capture continues** and the station goes `OFFLINE_BUFFERING`, not down. Keep all ElevenLabs-specific parsing isolated here. Do not block the MVP on exact wire details — implement cleanly, record assumptions in `docs/ARCHITECTURE.md`, and ensure `STT_PROVIDER=mock` is flawless.

Fixture lines to ship:

```
Moderator: Welcome to tonight's Founder Fundraising Panel.
Investor: The founders who get funded fastest can explain distribution before product.
Founder: We treated investor updates as a product habit, not a fundraising chore.
Investor: Warm introductions work best when the ask is specific and time-boxed.
Founder: Our seed round closed because we showed retention, not vanity growth.
Audience: How do you decide which investors to follow up with first?
Moderator: Let's talk about what a great monthly update actually contains.
Investor: Show me the one metric that proves the business is compounding.
```

---

## 11. Relay — `relay/`

`RelayService`: receive committed segment → persist to `transcript_segments` → enqueue in `relay_queue` (status `pending`) → flush loop every `RELAY_FLUSH_INTERVAL_MS` posts pending rows **in `sequence` order** to `VOICE_INGEST_URL` via `IngestClient`. On success mark `sent`; on failure keep `pending`, increment `attempts`, set `next_attempt_at` with exponential backoff between `RELAY_INITIAL_BACKOFF_MS` and `RELAY_MAX_BACKOFF_MS`, cap at `RELAY_MAX_ATTEMPTS` then mark `dead`. Idempotent by `segment_id` (the `UNIQUE` constraint + `Idempotency-Key` header). When the queue is non-empty the station is `OFFLINE_BUFFERING`; when it drains to zero it returns to `RECORDING` via `SYNCING`. Expose `queued_segments`/`sent_segments`/`dead_segments`/`last_flush_at`/`last_error` to `/status`.

Ingest payload + headers:

```json
{ "station_id":"MPS-001","session_id":"VI-...","segment_id":"seg_123","sequence":42,
  "start_ms":123000,"end_ms":127000,"text":"...","speaker_label":"Investor",
  "language_code":"en","committed_at":"...","source":"meetpaper_station","provider":"mock","raw":{} }
```
```
Authorization: Bearer <station_token or VOICE_INGEST_TOKEN>
Content-Type: application/json
Idempotency-Key: <segment_id>
```

---

## 12. Mock ingest + fault injection — `control/`

When `ENABLE_MOCK_INGEST=true`, mount inside the same Fastify app:

```
POST /mock/ingest            accepts a segment, stores it in memory
GET  /mock/ingest/segments   returns received segments (for verification)
```

`/simulate/network/down` flips an in-memory flag so `/mock/ingest` returns `503` and `IngestClient` POSTs fail. `/simulate/network/up` restores `200`. `/simulate/stt/drop` and `/simulate/stt/reconnect` toggle the mock STT provider's connected state. **This is the engine of the demo** — the whole network-drop story is driven from these four endpoints and the dashboard buttons that call them.

---

## 13. Hardware abstraction — `hardware/`

```ts
export interface HardwareController {
  readonly name: string;
  init(): Promise<void>;
  setState(state: StationState): Promise<void>;
  pulse?(kind: "teal" | "amber" | "red" | "white"): Promise<void>;
  shutdown(): Promise<void>;
}
```

- **`ConsoleHardwareController`** (default) — logs transitions and feeds the dashboard's `hardware.last_state`.
- **`GpioHardwareController`** (only if `ENABLE_GPIO=true`) — drive LEDs via Linux `gpiod` CLI if present; if GPIO init fails, log and **fall back to console — never crash recording.** Button: short press = `/mark`, long press = safe stop. If button watching is risky for the MVP, implement the interface and document the dashboard fallback. The M-305 + Pi 5 kit for this hackathon has no LEDs wired, so console is the path; keep GPIO clean but dormant.

---

## 14. Report — `report/`

On `POST /stop`, after the queue flush attempt, write `data/reports/<session_id>.json` and serve it. Provide **two** representations at `GET /report/:sessionId`:

- **JSON** when the request `Accept`s `application/json` (or `?format=json`) — the machine shape below.
- **A styled HTML page** by default (browser navigation) — the demo's closing beat. Same MeetPaper identity as the dashboard (masthead, tokens, fonts): a title block with session name + duration, a **health summary row** (audio gaps `0`, segments, network interruptions, queued remaining `0`), the **full transcript** rendered editorially (speaker labels, readable line length — this is the “gapless” proof), and the **insight marks** called out as pull-quotes with their ±30s window. It should look like a MeetPaper article, because that is exactly what Voice Intelligence ultimately produces. Render it server-side from the report JSON (a small template function is fine — no framework).

JSON shape:

```json
{ "session_id":"...","title":"...","started_at":"...","stopped_at":"...","duration_ms":3600000,
  "station_id":"MPS-001",
  "summary": { "headline":"Panel transcript captured by MeetPaper Station",
               "note":"AI summary hook not enabled in MVP. Transcript and insight marks available." },
  "transcript": [], "insight_marks": [],
  "health": { "audio_gaps":0, "transcript_segments":52, "queued_segments_remaining":0,
              "network_interruptions":1, "stt_interruptions":0 } }
```

Include transcript text inside each insight mark's window where available. Add a disabled `summariseWithLLM()` hook — do not call any LLM by default.

---

## 15. Dashboard — `public/` (MeetPaper editorial identity) — THE SURFACE JUDGES SEE

**This is the most visible artefact in the build. Treat it as a designed object, not a debug panel.** At a hackathon the dashboard *is* the demo — nobody reads the TypeScript; they watch this screen. Spend real care here.

### Visual reference — match it, don't reinvent it

There is a concept paper in this repo at **`devops/design/meetpaper_station_concept.html`** (and the full original at `../apm/devops/design/meetpaper_station.html` if reachable). **Open it, read its `<style>` block, and reuse its exact design language** — the same tokens, type scale, masthead treatment, dark section-nav bar, pulsing teal LED, dashed-rule dividers, and the cream surface floating on a warm neutral stage. The dashboard is a live control surface rather than an editorial page, but it must look like it belongs to the same product. When in doubt about a spacing, weight, or colour choice, copy what the concept paper does.

### Tokens (exact — these match `apm/css/meetpaper.css`)

```
--mp-paper:  #F3ECD9   --mp-paper-2: #ECE3CC   (surfaces)
--mp-ink:    #1A1815   --mp-ink-3:   #6B645B   (text)
--mp-accent: #7A1F2B   (burgundy — recording / critical)
--mp-teal:   #00C49A   (delivery healthy / synced / live LED)
--mp-gold:   #B98A2C
--mp-amber:  #F5A623   (OFFLINE_BUFFERING — the alarm colour)
--mp-stage:  #C8C1B5   (page background behind the paper surface)
```
Define these as CSS custom properties at `:root` for the dashboard — **except the masthead logo colours, which must be hardcoded per-span** (`Meet` in `#1A1815`, `Paper` in `#7A1F2B`); CSS variables on the logo broke during the concept-paper build. Fonts from Google Fonts: **DM Serif Display** (masthead + section headings), **Source Serif 4** (body + italic straplines), **Inter** (UI labels — uppercase, letter-spaced ~0.16em), **JetBrains Mono** (all metrics and code).

### Layout, top to bottom

- **Live strip** (dark `--mp-ink` bar, full width): a burgundy `RECORDING`/`OFFLINE`/`READY` pill on the left with a blinking dot, then a scrolling/static status line — session title, code, elapsed. Mirrors the concept paper's `.st-strip`.
- **Masthead:** `MeetPaper` in DM Serif Display (~64–88px on screen; smaller than the paper's 116px but same proportion), `Meet` in ink, `Paper` in burgundy. Strapline *“The room keeps recording. Even when the internet doesn’t.”* in Source Serif italic. A pulsing teal LED dot beside a `STATION` badge, exactly like the paper.
- **Status strip** (the instrument cluster): a horizontal row of labelled metrics, each a small uppercase Inter label above a JetBrains Mono value: **STATE · TIMER · SESSION · MIC · STT · RELAY · QUEUE · CHUNKS · SECONDS SAFE · LAST ERROR**. The STATE value is colour-coded to the state (red recording, amber offline, teal synced). QUEUE and SECONDS SAFE are the two numbers the audience watches move — make them slightly larger.
- **Controls** (styled like the concept paper's black section-nav, uppercase Inter): `Pair` · `Start` · `Pause` · `Resume` · `Stop` · `Mark Insight` · then a visually separated pair of *demo* buttons `Simulate network drop` and `Reconnect network` (give these two a distinct treatment — outlined, slightly set apart — so the presenter can find them instantly under pressure).
- **Live transcript panel:** committed segments in order, each with speaker label (Source Serif, speaker label in small-caps Inter), newest at the bottom, auto-scroll. A faint partial line at the bottom if one is present.
- **Health log panel:** recent `session_events`, monospace, newest first — offline/online changes, queue flushes, marks.
- **Report panel:** after stop, a prominent link/button to the report (see §14 styled report).

### State banners — the emotional beats (make them unmissable)

A single large banner region below the masthead changes with state. This is what the audience reads from across a room:

- **RECORDING** — calm: a thin burgundy rule + small notice *“Recording in progress. Audio is captured locally on this Station.”*
- **OFFLINE_BUFFERING** — **the peak.** Full-width banner in `--mp-amber`, large DM Serif: **`OFFLINE — AUDIO SAFE`**, subline *“Segments queued locally. Recording continues.”* plus the live queue count. It must appear *instantly* on the simulate-drop click and feel like an alarm that is nonetheless reassuring. Consider a subtle pulse.
- **SYNCING** — full-width banner in `--mp-teal`: **`SYNCING`**, subline *“Queued segments delivering in timestamp order — N remaining”* counting down to zero.
- **REPORT_READY** — teal-solid confirmation with the report link.

Vanilla JS only, no framework. Poll `/status`, `/events`, `/transcript` every 1–2s and diff into the DOM (don’t blow away the transcript on each poll). Keep `ELEVENLABS_API_KEY` and all secrets server-side — never reference them in `app.js`.

---

## 16. Logging + health events — `logger.ts`, `state/HealthLog.ts`

`pino` (pretty in dev). Every important transition writes a `session_events` row with one of these types: `station_started, pairing_started, pairing_completed, recording_started, audio_chunk_opened, audio_chunk_closed, stt_connected, stt_disconnected, segment_committed, segment_enqueued, relay_send_success, relay_send_failed, network_down_simulated, network_up_simulated, queue_flush_started, queue_flush_completed, insight_marked, recording_paused, recording_resumed, recording_stopped, report_generated, hardware_state_changed, error`. `GET /events` returns the most recent.

---

## 17. Tests — `test/` (vitest)

All tests run with no mic, no ElevenLabs, no Pi, no cloud:

- **State machine:** `IDLE→PAIRING→READY→RECORDING`; `RECORDING→OFFLINE_BUFFERING` on relay failure; `OFFLINE_BUFFERING→SYNCING→RECORDING` on flush; `RECORDING→STOPPING→REPORT_READY`; illegal transitions rejected.
- **Queue ordering:** enqueue seq 1,2,3; ingest fails; restore; assert send order 1,2,3 and rows become `sent`.
- **Idempotency:** enqueue same `segment_id` twice → exactly one row.
- **WAV writer:** write fake PCM, close chunk, file exists, header plausible, metadata stored; reopen-on-startup repairs an open chunk.
- **Mock transcript:** emits committed segments, sequence increments, lines come from fixture.
- **API smoke:** build server in test mode; `POST /pair → /start → GET /status → POST /mark → /simulate/network/down → status shows queue growing → /simulate/network/up → queue drains`.

`buildServer()` in `control/server.ts` must be importable without listening, so tests inject it directly.

---

## 18. Pi + ops — `scripts/`, `systemd/`, `docs/`

- Keep the existing `scripts/deploy-pi.sh` (rsync + pm2). Add `scripts/check-audio.sh` (`arecord -l` + a 5s test capture + `aplay`).
- `systemd/meetpaper-station.service` — `Restart=always`, `After=network-online.target sound.target`, `WorkingDirectory=/opt/meetpaper-station`, `EnvironmentFile=…/.env`, `User=pi`. Document install; do not run systemd automatically.
- `docs/PI_SETUP.md` — `sudo apt install -y alsa-utils sqlite3 libsqlite3-dev gpiod`; note Node 22 install (non-destructive); `hostname -I` to find the Pi IP; how to confirm the M-305 device string and update `AUDIO_DEVICE`.
- `docs/ARCHITECTURE.md` — the three services, the state machine, the data model, and every assumption you made (especially ElevenLabs wire format).
- `docs/DEMO_SCRIPT.md` — the under-2-minute run (see §20).

---

## 19. README

Cover: what MeetPaper Station is · the tagline · architecture diagram (ASCII is fine) · quick start in mock mode · running on the Pi · the offline-buffering demo · env vars · enabling real ElevenLabs · connecting real ApresMeet ingest · dashboard URL · troubleshooting · known limitations · **a recording-consent note** (organisers must obtain consent from speakers/attendees). Commands:

```bash
cp .env.example .env
npm install
npm run dev
# open http://localhost:3456
```

---

## 20. The demo this must deliver (the acceptance story)

```
1. Open the MeetPaper Station dashboard at http://localhost:3456
2. Pair session with code 482913
3. Start recording  → state RECORDING, red indicator, queue 0, WAV chunks climbing
4. Mock transcript segments appear in order
5. Press Mark Insight  → insight stored, health log shows it
6. Click Simulate network drop  → banner AMBER: "OFFLINE — AUDIO SAFE", queue grows, WAV keeps climbing
7. Click Reconnect  → SYNCING (teal), queue flushes to 0 in order, back to RECORDING
8. Stop recording  → REPORT_READY
9. Open report  → transcript + insight mark + health log, gapless
10. Say: "The venue internet failed. The panel didn't."
```

---

## 21. Build order (work straight through — do not pause between phases)

1. **Skeleton** — package.json deps, tsconfig, config.ts (zod), logger, types, Fastify `/health`. Build.
2. **SQLite** — Database, migrations (auto-run), repositories. Test.
3. **State + events** — StationStateMachine, EventBus, HealthLog, `/status`, `/events`. Test.
4. **Mock capture** — MockAudioSource, WavChunkWriter, MockTranscriptProvider, CaptureService; segments persist. Run in mock mode.
5. **Relay + mock ingest** — RelayService, IngestClient, QueueRepository, mockIngestRoutes, simulateRoutes; queue-order + idempotency tests. Test + manual.
6. **Dashboard** — index.html/styles.css/app.js polling; controls; offline/audio-safe banner. Manual demo works end to end.
7. **Pi hooks** — ARecordAudioSource, FileReplayAudioSource, check-audio.sh, PI_SETUP, systemd, GPIO controller (dormant). Mock mode still perfect.
8. **ElevenLabs adapter** — ElevenLabsRealtimeProvider, isolated, documented. Mock stays default.
9. **Report** — generate on stop, serve `/report/:id`.
10. **Polish + verify** — `npm test` green, `npm run build` clean, README + docs done, update diary/project/job, commit, push.

After each phase keep going; the goal is one continuous build to a runnable demo.

---

## 22. Production-ish behaviours to include now

Graceful shutdown on SIGINT/SIGTERM · close current WAV chunk on shutdown · flush queue on stop · repair open WAV chunks on startup · never crash on relay failure · never crash on STT failure · keep local capture running if any cloud service fails.

## 23. Non-goals (leave clean TODO hooks, don't build)

Full ApresMeet UI · billing · premium gates · diarisation UI · multi-room · device fleet · OAuth · Stripe · mobile app · React dashboard · cloud deployment · real summarisation.

---

## 24. Acceptance criteria (all must hold)

1. Runs locally in mock mode with no mic/key/Pi/cloud. 2. Dashboard at `http://localhost:3456`. 3. Pair a local session. 4. Start recording with no microphone. 5. Mock transcript segments appear. 6. WAV chunks written even in mock mode. 7. Relay sends to mock ingest while up. 8. Network down → queue grows, state `OFFLINE_BUFFERING`. 9. Network up → queue flushes to zero in order. 10. Mark Insight stored. 11. Stop → report opens. 12. `npm test` passes. 13. `npm run build` passes. 14. README covers local/Pi/mock/real modes. 15. No secrets committed. 16. Mock mode never broken by real adapters.

---

## 25. Coding style

TypeScript strict; small classes behind explicit interfaces; `zod` for request bodies; no `any` (use `unknown` + narrow); clear typed errors; services decoupled via interfaces; mock mode first-class; ESM imports with `.js`; `void`-cast floating promises in event handlers; `AbortSignal.timeout()` on every fetch; log useful operational events. A judge should understand the running app in 30 seconds.

---

## 26. When finished — close the loop (required)

1. `npm run typecheck` and `npm run build` clean; `npm test` green.
2. Update `devops/ai/diary.md` with a dated entry: what was built, every assumption made (ElevenLabs wire format especially), what is real vs mocked, and open issues.
3. Append a full run report to `devops/ai/project.md` (start/end/model/prompt/outcome, files changed, test results).
4. Set `devops/ai/job.md` STATUS to DONE and point to the next job (J2: real ElevenLabs live test on the Pi; J3: build the `voice.apresmeet.com/ws/station/ingest` receiver on the apm/PHP side; J4: remote pairing validation).
5. `git add -A && git commit -m "[pi-station] MeetPaper Station MVP — mock-first capture/relay/control + dashboard"` and `git push origin main`.
6. End with a concise summary: files changed · commands run · test results · what works · what is stubbed/mocked · next recommended steps.

---

## 27. Final deliverable behaviour

> MeetPaper Station is running on a Raspberry Pi. It is recording a founder panel. The host browser is only a remote control. The internet drops. The Station turns amber: **"OFFLINE — AUDIO SAFE."** Audio and transcript segments continue locally. The internet returns. The queue flushes in order. The transcript is gapless. The organiser stops the session and gets a MeetPaper report.

Build that — complete, runnable in mock mode, and demo-ready in one pass.
