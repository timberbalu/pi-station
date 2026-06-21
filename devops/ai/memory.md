# pi-station — Engineering Memory & Coding Principles

> **Orientation first:** read `devops/ai/START_HERE.md` before this file. It carries the product boundary, stack, and file manifest.
>
> **Session narrative:** see `devops/ai/diary.md` for the session log, decisions, and where we left off.

---

## 1. The three guarantees — what Pi-Station exists to deliver

Pi-Station does exactly three things, and does them with complete reliability regardless of network state:

1. **Audio** — WAV buffer, always, gapless. The mic never stops writing to disk.
2. **Video** — local MP4 chunks, always. The camera never stops writing to disk.
3. **Transcript** — Whisper STT runs locally. The session has a usable transcript even if ElevenLabs was unreachable for the entire event.

These three are the capture guarantee. Everything else is the cloud's job:
- **CoCo** does post-session AI intelligence (summaries, insights). Do not duplicate this on the Pi — CoCo has real compute; the Pi at 5 t/s is a compromise, not a feature.
- **MeetPaper / Media Desk** handle publishing and distribution.
- **ElevenLabs** is an optional admin-triggered quality upgrade, not a dependency.
- The Pi does not post-process, does not summarise, does not speak back to the room.

**The boundary is the product.** The Pi is physically present in the room and guarantees capture. The cloud is everywhere else.

---

## 1a. Pi-Station is a generic multi-component capture platform

Voice is the first component. Video is the second. Others (Bluetooth interaction, etc.) will follow. The host owns: device, session lifecycle, SQLite, control API, dashboard, aggregate state machine, and the network-resilience guarantee. Each component owns: its source, its local buffer, its optional relay, its status, and its report contribution.

- Implement `StationComponent` interface (`src/components/StationComponent.ts`) for every new capability.
- Register in `src/components/registry.ts`, enable via `ENABLED_COMPONENTS` env var.
- Station is OFFLINE_BUFFERING if **any** component is buffering. Healthy only when **all** drain.
- Resilience logic lives in the host — components only report `buffering: boolean` and `queuedItems: number`.
- After J3: anything voice-specific lives in `src/components/voice/`. Anything video-specific in `src/components/video/`. Nothing component-specific in `StationApp`.

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

---

## 8. STT on the Pi — technology choice (quality first)

**The choice is between Vosk, faster-whisper, and ElevenLabs Scribe. Choose based on what is best for the product, not what the hackathon recommends.**

| Provider | Accuracy | Latency | Offline | Diarisation | Verdict |
|---|---|---|---|---|---|
| Vosk (small-en) | Basic | Live streaming | Yes | No | Too weak for professional events |
| faster-whisper (base.en) | Good | Near-real-time | Yes | No | Right local quality ceiling |
| faster-whisper (small.en) | Very good | ~2× audio | Yes | No | Better accuracy, slower |
| ElevenLabs Scribe v2 | Excellent | Live streaming | No | Yes | Best quality, requires internet |

**The honest recommendation for this product:**

- **Primary (online):** ElevenLabs Scribe v2. Best accuracy, live streaming, diarisation. This is what professional organisers expect.
- **Local fallback (offline):** faster-whisper with `base.en` or `small.en`. Better accuracy than Vosk. Runs post-session batch on the buffered WAV when internet is unavailable. The admin can choose to upgrade via ElevenLabs later (J7).
- **Vosk is not recommended** for this product. Its accuracy is too low for professional event transcription. The fact that the hackathon recommends it is not a reason to use it.

**Provider interface** (`STT_PROVIDER` env var): `mock` | `elevenlabs` | `faster-whisper`. No Vosk implementation needed unless a specific use case emerges that requires it.

**faster-whisper installation on Pi:**
```bash
pip install faster-whisper
# Model download (one-time):
python -c "from faster_whisper import WhisperModel; WhisperModel('base.en')"
# base.en: ~145MB, good quality. small.en: ~466MB, better quality.
```
Runs as a Python subprocess called from the Node.js SyncService after session stop. Not a live streaming provider — a batch provider that processes WAV chunks and returns transcript segments with timestamps.

---

## 9. AI HAT+ (26 TOPS Hailo NPU) — vision only, not STT

The quickstart rule of thumb: **AI HAT+ for live camera-based vision, CPU for STT/TTS/LLM.**

- Accelerates: face detection, object detection, pose estimation, segmentation — at 30fps vs 1–2fps on CPU
- Does NOT accelerate: Whisper, Vosk, Ollama, NeuTTS — these are CPU-bound regardless
- Auto-detected by Pi OS via PCIe Gen 3. Install: `sudo apt install hailo-all && sudo reboot`
- Check: `hailortcli fw-control identify`
- Run vision: `rpicam-hello -t 0 --post-process-file /usr/share/rpi-camera-assets/hailo_yolov8_inference.json`
- 26 TOPS: can run multiple models simultaneously (face detection + pose + object detection all at once)
- Models must be compiled to Hailo format on x86 first — pre-compiled models available via rpicam-apps

---

## 10. Pan/tilt speaker-tracking camera — the vibrant event feature

The kit contains everything needed: Pi Camera Module (CSI), PCA9685 servo driver (I2C), MG996R + SG90 servos.

**Architecture:**
- AI HAT+ face detection at 30fps → face bounding box centre position in frame
- Compute pan/tilt delta: `error_x = face_centre_x - frame_width/2`, same for y
- PCA9685 over I2C → PWM servo commands (use `adafruit-circuitpython-pca9685` or `gpiozero`)
- MG996R servo for pan (needs torque for camera weight), SG90 for tilt
- Smooth tracking: apply a deadzone (don´t move if face is within ±20px of centre) + low-pass filter on servo position to avoid jitter

**Voice-face locking heuristic (hackathon-grade):**
1. Voice activity detection: energy threshold on audio stream (`audioop.rms` or similar)
2. On speech start → lock to face nearest frame centre
3. Servo smoothly tracks that face’s bounding box centre
4. On 2s silence → release lock, return to neutral

**Servo range:** 0–180 degrees per servo (standard PWM). Two servos cover the full frontal arc of a seated panel. True 360-degree rotation requires continuous-rotation servos (not in the kit).

**Camera module:** CSI ribbon connector, contacts facing the USB ports. Test first with `rpicam-hello`.

**The PCA9685 drives servos over I2C** — one I2C link controls 16 channels. Power the servos from a separate 5V supply (not from the Pi’s GPIO pins — Pi GPIO is 3.3V only and cannot supply servo current).

**NeuTTS spoken announcements (optional):** the kit includes MAX98357 amp + wired speaker. NeuTTS runs on CPU (not HAT+). Can speak “Recording started”, “Syncing”, “Session saved” through the amp. Keep behind a feature flag; not a core dependency.
