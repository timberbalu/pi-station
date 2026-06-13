# pi-station — Engineering Memory & Coding Principles

> **Orientation first:** read `devops/ai/START_HERE.md` before this file. It carries the product boundary, stack, and file manifest.
>
> **Session narrative:** see `devops/ai/diary.md` for the session log, decisions, and where we left off.

---

## 1. The one invariant that cannot break

**Recording must survive a network drop.**

If `voice.apresmeet.com` is unreachable for any reason — venue Wi-Fi down, ElevenLabs WS dropped, DNS failure, anything — the Pi must:
1. Keep recording audio to the local WAV buffer.
2. Queue committed segments in SQLite (`queue.db`).
3. Flush the queue, in `captured_at` order, when connectivity returns.

The host's browser being closed, the laptop dying, the tab navigating away — none of these should stop recording. The Pi is the recording device; the browser is just the control surface.

---

## 2. Audio capture conventions

- **`arecord` is the audio source on Pi OS.** Command: `arecord --device=plughw:1,0 --format=S16_LE --rate=16000 --channels=1 --file-type=raw -`
- **16kHz mono PCM** is the target format for ElevenLabs Scribe v2. Do not change this without checking ElevenLabs docs.
- **USB device index.** The M-305 mini USB mic typically appears as `plughw:1,0` on Pi OS when the Pi's built-in audio is `plughw:0,0`. Verify with `arecord -l` on the Pi. Document the confirmed device string in `devops/hardware/device-config.md`.
- **WAV buffer rotation:** every 30 seconds, close the current chunk file and open a new one. Naming: `chunk-NNNN.raw`. Keep the last N chunks (configurable; default: keep all during session, prune after session ends).
- **On Mac dev:** arecord does not exist. Use `sox` or `ffmpeg` as a drop-in, or mock the spawn with a sine wave generator. Mark clearly with `// DEV ONLY — replace with arecord on Pi`.

---

## 3. ElevenLabs Scribe v2 WebSocket

- **Endpoint:** `wss://api.elevenlabs.io/v1/speech-to-text/stream`
- **Auth header:** `xi-api-key: <ELEVENLABS_API_KEY>`
- **Session config message (send on open):**
  ```json
  { "sample_rate": 16000, "encoding": "pcm_s16le", "language": "en", "diarize": true }
  ```
- **Segment detection:** listen for `{ "type": "transcript", "is_final": true }` frames. Discard partial (`is_final: false`) frames — they're for display only, not for storage.
- **Reconnect policy:** if the WS drops while recording, wait 2s and reconnect. Raw audio continues buffering to disk during the gap. On reconnect, resume streaming from the live mic (not from buffer — the Pi hasn't lost audio, ElevenLabs just missed a window).
- **Speaker diarisation:** `speaker_id` in the segment payload maps to `VI_SPEAKERS` on the server side. Pass it through as-is; the server resolves display names.

---

## 4. SQLite queue schema

```sql
CREATE TABLE IF NOT EXISTS queue (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  payload    TEXT    NOT NULL,  -- JSON-serialised TranscriptSegment
  attempts   INTEGER NOT NULL DEFAULT 0,
  next_retry INTEGER NOT NULL DEFAULT 0  -- Unix ms
);
```

- **Flush cycle:** every 5 seconds, process up to 10 queued rows where `next_retry <= now`.
- **Backoff:** `min(5000 * 2^attempts, 300_000)` ms. Max 5 minutes between retries.
- **On successful POST:** delete the row.
- **On failure:** increment `attempts`, set `next_retry`, leave the row.
- **Never drop a segment.** If all else fails, the raw WAV buffer on disk is the recovery path.

---

## 5. pi-control API conventions

- **Port:** 3456 (configurable via `CONTROL_PORT` env).
- **CORS:** `Access-Control-Allow-Origin: *` — the Live Desk may call from any local origin.
- **State machine:**
  ```
  idle → recording → paused → recording → stopped
       ↘                               ↗
        ────────────────────────────────
  ```
- **`/status` response fields** (all required — the Live Desk status widget depends on them):
  ```typescript
  {
    state:         'idle' | 'recording' | 'paused' | 'stopped'
    session_code:  string | null
    started_at:    string | null   // ISO timestamp
    queue_depth:   number          // segments waiting in SQLite
    recording:     boolean         // arecord process alive
    ws_connected:  boolean         // ElevenLabs WS open
    buffer_dir:    string          // local WAV buffer path
    timestamp:     string          // ISO — when status was generated
  }
  ```
- **`/pair` body:** `{ session_code: string }`. Validate the code against `voice.apresmeet.com/ws/station/pair` before accepting (TODO: implement validation endpoint on the server).
- **Content-Type:** always `application/json`. No form bodies.

---

## 6. TypeScript patterns

- **`as const` on config** — all config values are readonly at the type level.
- **No `any`** — use `unknown` + narrowing or explicit typed interfaces.
- **EventEmitter typing** — extend `EventEmitter` and declare event signatures explicitly.
- **`AbortSignal.timeout(ms)`** for fetch calls — prevents hung network requests from blocking the relay.
- **`void`-cast promises in event handlers** — `captureService.on('segment', (s) => { void this._deliver(s); })` — required by `@typescript-eslint/no-floating-promises`.
- **ESM imports** — all local imports must include `.js` extension (NodeNext module resolution).

---

## 7. Deployment conventions

- **Target:** `pi@pi-station.local` (mDNS hostname). Configurable via `scripts/deploy-pi.sh` arg.
- **Process manager:** `pm2` — `pm2 start dist/index.js --name pi-station`. Survives terminal close and Pi reboots (`pm2 startup`).
- **Never deploy `.env`** — set environment variables on the Pi manually or via `pm2 ecosystem.config.js`.
- **Never deploy `node_modules`** — `npm install --production` on the Pi after rsync.
- **Build before deploy:** `npm run build` locally, rsync `dist/` to the Pi (faster than running `tsx` in production).
- **Audio device config:** document the confirmed `arecord` device string in `devops/hardware/device-config.md` after first physical setup.
