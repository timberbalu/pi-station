# PI_STATION_J6 — VideoComponent: libcamera + AI HAT+ face detection + pan/tilt servo tracking

> **Full-authorisation mode.** No approval prompts. Read `CLAUDE.md`.
>
> **Read first:** `devops/ai/START_HERE.md`, `devops/ai/diary.md`, `devops/ai/memory.md`.
>
> **Recommended model:** Claude Opus.
>
> **Depends on:** J3 (component platform — `StationComponent` interface exists), J2 (Pi running with camera and AI HAT+ installed).
>
> **Strategic note:** the hackathon is a growth hacking technique. Build for the product, not the prize. Every decision here should be one you'd make shipping to real event organisers.

---

## 1. What this job delivers

Three things, tightly integrated:

1. **`VideoComponent`** — real implementation replacing the stub. libcamera captures rolling MP4 chunks to disk. Feeds into the J3b SyncService phase 3 (S3 upload) automatically.
2. **AI HAT+ face detection** — `rpicam-apps` + Hailo NPU running face detection at 30fps. Zero CPU overhead. Face bounding box positions timestamped and stored.
3. **Pan/tilt speaker tracking** — PCA9685 servo driver over I2C → MG996R (pan) + SG90 (tilt). Camera physically follows the active speaker. Voice activity detection on the audio stream drives face-lock.

**The prime directive:** mock mode must still work perfectly with no camera, no AI HAT+, no servos. All hardware is behind interfaces with mock defaults, selected by env var. `ENABLED_COMPONENTS=voice` still boots cleanly with no video.

---

## 2. Storage structure — establish this first, before any capture code

**This is the most important section in the prompt. Read it before writing a single line.**

The current data dir (`DATA_DIR=/home/pistation/pi-station/data`) is inside the app directory. Before J6 adds video (which can be ~900MB/hour at 720p), move data outside the app directory so it survives deploys and is easy to manage.

### 2a. New data directory structure on the Pi

```
/home/pistation/data/                    ← outside the app, never touched by rsync deploys
  meet-station/
    sessions/
      {session_id}/
        audio/
          chunk-0001.wav                 ← 30s WAV chunks (written by VoiceComponent)
          chunk-0002.wav
          ...
        video/
          chunk-0001.mp4                 ← 30s MP4 chunks (written by VideoComponent)
          chunk-0002.mp4
          ...
        transcripts/
          whisper-{timestamp}.txt        ← faster-whisper output (J5)
        faces/
          {chunk_index}-faces.json       ← face detection timestamps per chunk
    sqlite/
      station.sqlite                     ← all metadata, queues, sync state
    reports/
      {session_id}.json                  ← session reports
    logs/
      meet-station.log                   ← pm2 log redirect (optional)
```

**Key decisions:**
- `sessions/{session_id}/audio/` mirrors S3 key structure (`vi-media/sessions/{id}/audio/`) — local = remote, makes sync obvious
- `sessions/{session_id}/video/` same mirror
- `faces/` stores NPU output as JSON per chunk — not uploaded to S3 (processed locally, used for servo tracking and report annotation)
- `sqlite/` separate from sessions so the DB is never accidentally included in a session cleanup
- Reports separate from sessions for the same reason

### 2b. Config changes — add to `.env.example` and `core/src/config.ts`

New env vars (add alongside existing `AUDIO_DIR`):

```bash
# Data directories — outside the app dir, survives deploys
DATA_DIR=/home/pistation/data/meet-station
SQLITE_PATH=/home/pistation/data/meet-station/sqlite/station.sqlite
AUDIO_DIR=/home/pistation/data/meet-station/sessions
VIDEO_DIR=/home/pistation/data/meet-station/sessions
FACES_DIR=/home/pistation/data/meet-station/sessions
REPORTS_DIR=/home/pistation/data/meet-station/reports

# Video capture
VIDEO_SOURCE=mock             # mock | libcamera
VIDEO_DEVICE=/dev/video0      # libcamera device (usually /dev/video0 on Pi)
VIDEO_WIDTH=1280
VIDEO_HEIGHT=720
VIDEO_FPS=30
VIDEO_CHUNK_SECONDS=30        # rotate MP4 every 30s, same as audio
VIDEO_BITRATE=2000000         # 2 Mbps for 720p — ~900MB/hr

# AI HAT+ / face detection
FACE_DETECTION=mock           # mock | hailo | opencv
HAILO_POST_PROCESS_FILE=/usr/share/rpi-camera-assets/hailo_yolov8_inference.json

# Pan/tilt servo
PAN_TILT=mock                 # mock | pca9685
PAN_TILT_I2C_BUS=1
PAN_TILT_I2C_ADDRESS=0x40
PAN_TILT_PAN_CHANNEL=0        # PCA9685 channel for pan servo (MG996R)
PAN_TILT_TILT_CHANNEL=1       # PCA9685 channel for tilt servo (SG90)
PAN_TILT_PAN_MIN=30           # degrees
PAN_TILT_PAN_MAX=150
PAN_TILT_TILT_MIN=60
PAN_TILT_TILT_MAX=120
PAN_TILT_NEUTRAL_PAN=90       # centre position
PAN_TILT_NEUTRAL_TILT=90
PAN_TILT_DEADZONE_PX=20       # don't move if face is within ±20px of centre
PAN_TILT_SMOOTHING=0.3        # low-pass filter coefficient (0=instant, 1=no movement)
```

Add `VIDEO_DIR`, `FACES_DIR`, `REPORTS_DIR`, `video`, `faceDetection`, `panTilt` sections to the config schema in `core/src/config.ts`. Same zod pattern as existing fields.

### 2c. Migrate on the Pi

Add a migration step to `scripts/provision-pi.sh` (or a new `scripts/migrate-data-dir.sh`):

```bash
#!/usr/bin/env bash
# Migrate data from inside-app to outside-app directory
# Safe to run multiple times (idempotent)
SSH_TARGET="${1:-pistation@pistation.local}"

ssh "$SSH_TARGET" '
  # Create new structure
  mkdir -p /home/pistation/data/meet-station/{sessions,sqlite,reports,logs}

  # Move existing SQLite if present
  if [ -f /home/pistation/pi-station/data/station.sqlite ]; then
    cp /home/pistation/pi-station/data/station.sqlite \
       /home/pistation/data/meet-station/sqlite/station.sqlite
    echo "  ✓ SQLite migrated"
  fi

  # Move existing audio sessions if present
  if [ -d /home/pistation/pi-station/data/audio ]; then
    cp -r /home/pistation/pi-station/data/audio/. \
          /home/pistation/data/meet-station/sessions/
    echo "  ✓ Audio sessions migrated"
  fi

  echo "  ✓ Data directory migration complete"
  echo "  New location: /home/pistation/data/meet-station/"
'
```

Then update the Pi's `.env` via SSH to point to the new paths.

---

## 3. VideoComponent — `apps/meet-station/src/components/video/VideoComponent.ts`

Replace the stub entirely. Implements `StationComponent`.

### 3a. VideoSource interface

```typescript
// components/video/VideoSource.ts
export interface VideoChunk {
  path: string;           // absolute path to the MP4 chunk file
  chunkIndex: number;
  startMs: number;
  durationMs: number;
  sizeBytes: number;
}

export interface VideoSource {
  readonly name: string;
  start(sessionDir: string, onChunk: (chunk: VideoChunk) => void): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}
```

### 3b. MockVideoSource (default)

Emits fake chunk events on a timer. Creates tiny placeholder files (`touch chunk-NNNN.mp4`). No camera needed. Mock mode must work perfectly.

### 3c. LibcameraVideoSource (Pi)

Spawns `rpicam-vid` to capture rolling MP4 chunks:

```bash
rpicam-vid \
  --width 1280 --height 720 \
  --framerate 30 \
  --bitrate 2000000 \
  --codec h264 \
  --segment 30000 \
  --output {sessionDir}/video/chunk-%04d.mp4 \
  --nopreview \
  -t 0
```

Handle process errors gracefully — if `rpicam-vid` is not found or camera is not connected, log clearly and move to ERROR state. Never crash the server.

On each new chunk file detected (inotify or polling): emit a `VideoChunk` event, write metadata to `audio_chunks` table (reuse with `media_type='video'`), enqueue in `media_transfer_queue` for J3b SyncService.

### 3d. VideoComponent wiring

```typescript
export class VideoComponent implements StationComponent {
  readonly id = 'video';
  readonly label = 'Video';

  // init: set up dirs, select VideoSource based on VIDEO_SOURCE env
  // startSession: create session/video dir, start VideoSource
  // stopSession: stop VideoSource, finalise chunk metadata
  // getStatus: { id, label, healthy, buffering, queuedItems, detail: { chunks, source } }
  // contributeToReport: { id, label, summary, items: chunk list, health }
}
```

Session video directory: `{VIDEO_DIR}/{session_id}/video/`

---

## 4. Face detection — `hardware/src/camera/FaceDetector.ts`

```typescript
export interface FaceBox {
  x: number; y: number;
  width: number; height: number;
  confidence: number;
  timestampMs: number;
}

export interface FaceDetector {
  readonly name: string;
  start(onFaces: (faces: FaceBox[]) => void): Promise<void>;
  stop(): Promise<void>;
}
```

**MockFaceDetector** (default) — emits simulated face positions that drift slowly across the frame. Servo will visibly track them in mock mode. No camera needed.

**HailoFaceDetector** (Pi + AI HAT+) — runs `rpicam-hello` with the hailo post-process file in a subprocess, parses the JSON output for face bounding boxes. The AI HAT+ does the inference at 30fps; this class just reads the output stream.

```bash
rpicam-hello -t 0 \
  --post-process-file /usr/share/rpi-camera-assets/hailo_yolov8_inference.json \
  --nopreview \
  --verbose 0
```

Parse stdout JSON frames for `{"faces": [{"x":..,"y":..,"w":..,"h":..,"conf":..}]}`. If `hailo-all` is not installed or the HAT+ is not detected, fall back to MockFaceDetector and log a clear warning.

Store face timestamps per chunk in `{FACES_DIR}/{session_id}/faces/{chunk_index}-faces.json` for report annotation.

---

## 5. Pan/tilt tracking — `hardware/src/servo/PanTiltController.ts`

Replace the stub.

### 5a. PanTiltController interface (already in hardware/src/servo/)

```typescript
export interface PanTiltController {
  readonly name: string;
  init(): Promise<void>;
  setPosition(pan: number, tilt: number): Promise<void>;  // degrees
  getPosition(): { pan: number; tilt: number };
  returnToNeutral(): Promise<void>;
  shutdown(): Promise<void>;
}
```

### 5b. ConsolePanTiltController (default/mock)

Logs position changes. No hardware needed. Works in dev.

### 5c. PCA9685PanTiltController (Pi)

Drives servos via PCA9685 over I2C. Use the `i2c-bus` npm package (add to `hardware/package.json`):

```typescript
import i2c from 'i2c-bus';

// PCA9685 PWM frequency: 50Hz for servos
// Servo angle → PWM pulse: 1ms (0°) to 2ms (180°) at 50Hz
// pulse_length = (angle / 180) * (2048 - 102) + 102  (12-bit resolution)
```

**Safety rules:**
- Never drive servos from Pi GPIO pins — the PCA9685 has its own 5V supply
- Apply a deadzone: don't move if face is within `PAN_TILT_DEADZONE_PX` of frame centre
- Apply low-pass filter: `new_pos = current_pos + smoothing * (target_pos - current_pos)`
- Clamp to `PAN_MIN`/`PAN_MAX` / `TILT_MIN`/`TILT_MAX` — never command beyond physical limits
- On shutdown: return to neutral position, then disable PWM

If `i2c-bus` fails to open the bus (not on Pi, or PCA9685 not connected), fall back to ConsolePanTiltController and log clearly. Never crash.

### 5d. Voice-face lock orchestration — `components/video/SpeakerTracker.ts`

```typescript
export class SpeakerTracker {
  // Subscribes to: audio energy events (from VoiceComponent via EventBus)
  //               face detection events (from FaceDetector)
  // Outputs: pan/tilt position commands (to PanTiltController)

  // Algorithm:
  // 1. VAD: audio energy above threshold → speech active
  // 2. On speech start: lock to face nearest frame centre
  // 3. While locked: smooth-track that face's bounding box centre
  //    pan_target = neutral_pan + (face_centre_x - frame_width/2) * pan_scale
  //    tilt_target = neutral_tilt - (face_centre_y - frame_height/2) * tilt_scale
  // 4. On 2s silence: release lock, return to neutral
  // 5. If locked face leaves frame: release lock, scan slowly
}
```

The `SpeakerTracker` listens to the `StationEventBus` for audio energy events that `VoiceComponent` already emits. No direct coupling between VoiceComponent and VideoComponent — they communicate via the bus.

---

## 6. Hardware workspace updates

Implement the stubs created in J2b:

- `hardware/src/camera/CameraController.ts` → delegates to `LibcameraVideoSource` or `MockVideoSource`
- `hardware/src/servo/PanTiltController.ts` → delegates to `PCA9685PanTiltController` or `ConsolePanTiltController`

Add to `hardware/package.json` dependencies:
```json
"i2c-bus": "^5.2.3"
```

Note: `i2c-bus` will fail to compile on macOS (no `/dev/i2c-*`). Wrap the import in a try/catch and fall back to the mock controller if the native module fails to load. This is the same pattern as `better-sqlite3` native module — fail safe, never crash.

---

## 7. Dashboard updates

Add to the Components row (already has voice card from J3):

**Video card** when `ENABLED_COMPONENTS=voice,video`:
- Status: healthy / buffering / error
- Current chunk index + size
- Face detection: active / mock / disabled
- Pan/tilt: current position (pan°, tilt°) / mock / disabled
- Chunks queued for S3 sync

**Live face indicator** (optional, nice-to-have): a small overlay showing the current face lock status — "Tracking Speaker 1", "Scanning", "No face detected". Updates every 1s from `/status`.

---

## 8. Session directory creation

At session start, create the full directory tree atomically:

```typescript
import { mkdirSync } from 'node:fs';

function createSessionDirs(sessionId: string, config: PlatformConfig): void {
  const base = `${config.video.videoDir}/${sessionId}`;
  mkdirSync(`${base}/audio`, { recursive: true });
  mkdirSync(`${base}/video`, { recursive: true });
  mkdirSync(`${base}/transcripts`, { recursive: true });
  mkdirSync(`${base}/faces`, { recursive: true });
}
```

This replaces the ad-hoc `mkdir` calls that currently happen inside VoiceComponent and WavChunkWriter. The host calls `createSessionDirs` before `startSession` is fanned out to components.

---

## 9. Cleanup policy — post-sync pruning

After J3b marks `sync_complete = 1` for a session, local media files can be pruned to free disk space. Implement a `SessionCleaner` (or add to `SyncService`):

```typescript
// After sync_complete:
// - Delete sessions/{session_id}/audio/*.wav
// - Delete sessions/{session_id}/video/*.mp4
// - Keep: sessions/{session_id}/transcripts/ (small, useful locally)
// - Keep: sessions/{session_id}/faces/ (small, useful for local report)
// - Keep: sqlite/station.sqlite (always)
// - Keep: reports/{session_id}.json (always)
// Trigger: POST /sessions/:id/cleanup or automatic after sync_complete
```

Add `POST /sessions/:id/cleanup` to the control API. Log what was deleted and how much space was freed.

---

## 10. Tests

All tests must run with no camera, no AI HAT+, no servos, no i2c:

- `test/videoComponent.test.ts` — MockVideoSource emits chunks; VideoComponent lifecycle (init/start/stop); chunks recorded in audio_chunks table with media_type='video'; chunks enqueued in media_transfer_queue
- `test/faceDetector.test.ts` — MockFaceDetector emits face boxes; positions are valid (within frame bounds)
- `test/panTilt.test.ts` — ConsolePanTiltController accepts positions within bounds; clamps out-of-range inputs; returns to neutral on shutdown
- `test/speakerTracker.test.ts` — speech event → face lock; silence for 2s → release; face leaves frame → release
- `test/sessionDirs.test.ts` — `createSessionDirs` creates expected directory tree
- `test/sessionCleaner.test.ts` — after sync_complete, WAV and MP4 files are deleted; transcripts and reports are kept
- Update `test/aggregateState.test.ts` — VideoComponent buffering → station OFFLINE_BUFFERING

**All existing 48 tests must still pass.**

---

## 11. Build order

1. Config changes — `VIDEO_DIR`, `FACES_DIR`, `REPORTS_DIR`, `video`, `faceDetection`, `panTilt` sections. `.env.example` updated. Build.
2. Data migration script — `scripts/migrate-data-dir.sh`. Run on Pi if needed.
3. `VideoSource` interface + `MockVideoSource` + `LibcameraVideoSource`. Tests.
4. `FaceDetector` interface + `MockFaceDetector` + `HailoFaceDetector`. Tests.
5. `PanTiltController` interface + `ConsolePanTiltController` + `PCA9685PanTiltController`. Tests.
6. `SpeakerTracker`. Tests.
7. `VideoComponent` full implementation. Tests.
8. `createSessionDirs` host integration.
9. `SessionCleaner` + `POST /sessions/:id/cleanup`. Tests.
10. Dashboard video card + face indicator.
11. `ENABLED_COMPONENTS=voice,video` — full end-to-end in mock mode.
12. Deploy to Pi. Test with real camera + AI HAT+ (if available).
13. Close the loop.

---

## 12. Pi setup for this job (human prerequisites)

Before the LLM can test real hardware:

- [ ] Pi Camera Module connected via CSI ribbon (contacts facing USB ports). Test: `rpicam-hello` shows a preview.
- [ ] AI HAT+ fitted (if available). Test: `hailortcli fw-control identify` lists the Hailo device.
- [ ] PCA9685 connected via I2C (SDA=GPIO2, SCL=GPIO3). MG996R on channel 0, SG90 on channel 1. Separate 5V supply for servos. Test: `i2cdetect -y 1` shows device at 0x40.
- [ ] `sudo apt install -y hailo-all` if AI HAT+ is fitted and not already installed.
- [ ] `npm install -g i2c-bus` or add to package and deploy.

Mock mode works without any of the above.

---

## 13. Done criteria

- [ ] `VideoComponent` fully implemented (not stub) — replaces J3 stub
- [ ] `MockVideoSource` emits chunks; `LibcameraVideoSource` spawns rpicam-vid
- [ ] `MockFaceDetector` emits face boxes; `HailoFaceDetector` parses rpicam-apps output
- [ ] `ConsolePanTiltController` logs positions; `PCA9685PanTiltController` drives hardware
- [ ] `SpeakerTracker` locks to face on speech, releases on silence
- [ ] New data directory structure in config + `.env.example`
- [ ] `scripts/migrate-data-dir.sh` exists and is idempotent
- [ ] `createSessionDirs` called by host at session start
- [ ] `SessionCleaner` + `POST /sessions/:id/cleanup`
- [ ] Dashboard shows video card when enabled
- [ ] `ENABLED_COMPONENTS=voice,video` — full mock demo unchanged
- [ ] All 48 existing tests + all new tests green
- [ ] `npm run typecheck` clean, `npm run build` clean
- [ ] Deployed and verified on Pi (real camera / mock fallback documented)
- [ ] `devops/hardware/device-config.md` updated with camera + AI HAT+ + servo wiring
- [ ] Diary + project + job updated, committed, pushed

---

## 14. Close the loop

1. `npm run typecheck` + `npm run build` + `npm test` — all clean.
2. `devops/ai/diary.md` — what was built, what hardware worked, what fell back to mock, any surprises.
3. `devops/ai/project.md` — append run report.
4. `devops/ai/job.md` — STATUS DONE. Next job: J5 (faster-whisper STT wired into VoiceComponent) or J7 (cloud upgrade path).
5. `git commit -m "[pi-station] J6: VideoComponent + AI HAT+ face detection + pan/tilt speaker tracking"` + push.
