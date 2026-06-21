# PI_STATION_J5 — Local STT: faster-whisper as the offline transcript provider

> **Full-authorisation mode.** No approval prompts. Read `CLAUDE.md`.
>
> **Read first:** `devops/ai/START_HERE.md`, `devops/ai/diary.md`, `devops/ai/memory.md` (especially §8 — STT technology choice).
>
> **Recommended model:** Claude Sonnet.
>
> **Depends on:** J3 (VoiceComponent exists), J2 (Pi running with `scripts/transcribe.py` and `venv-whisper` already installed).

---

## 1. What this job delivers

Wire `faster-whisper` into `VoiceComponent` as the **post-session batch STT provider**. After `stopSession()` is called, the VoiceComponent calls `scripts/transcribe.py` on each closed WAV chunk, collects the JSON segments, and stores them in `transcript_segments` — exactly as if they had arrived from ElevenLabs during the session.

The result: a complete, usable transcript is available locally even if ElevenLabs was unreachable for the entire event. The J3b SyncService then delivers it to VI as part of the normal sync cycle.

**This is not a live streaming provider.** faster-whisper runs post-session on buffered WAV chunks. Live streaming STT during the session remains ElevenLabs (when online) or mock (dev). The batch path activates on `stopSession()` when `STT_PROVIDER=faster-whisper`.

---

## 2. Technology choice rationale (from memory.md §8)

**faster-whisper (base.en or small.en)** is chosen over Vosk. Vosk accuracy is too low for professional event transcription — the organisers who will use MeetStation run Founder Fundraising Panels and Investor Q&As where transcript quality matters. faster-whisper base.en gives meaningfully better accuracy and runs fully offline on the Pi's CPU.

- `base.en` (~145MB) — good quality, ~1–2× real-time on Pi 5 CPU
- `small.en` (~466MB) — better accuracy for noisy environments, ~3–4× real-time

The `venv-whisper` Python virtual environment and `base.en` model are already installed on the Pi from J2. `scripts/transcribe.py` already exists and returns JSON segments.

**STT_PROVIDER values:**
- `mock` — MockTranscriptProvider (dev, no hardware)
- `elevenlabs` — ElevenLabsRealtimeProvider (live streaming, cloud)
- `faster-whisper` — FasterWhisperProvider (batch, post-session, offline)

---

## 3. FasterWhisperProvider

Create `apps/meet-station/src/capture/FasterWhisperProvider.ts`.

This is a **batch provider**, not a streaming one. It does not implement `TranscriptProvider` (which is for live streaming). It is a standalone class called directly by `VoiceComponent.stopSession()`.

```typescript
export interface WhisperSegment {
  start: number;      // seconds
  end: number;        // seconds
  text: string;
  words: Array<{ word: string; start: number; end: number }>;
}

export interface WhisperResult {
  segments: WhisperSegment[];
  language: string;
}

export class FasterWhisperProvider {
  constructor(
    private readonly scriptPath: string,   // config.stt.fasterWhisperScript
    private readonly model: string,        // config.stt.fasterWhisperModel
    private readonly venvPython: string,   // path to venv-whisper python binary
    private readonly logger: Logger,
  ) {}

  /**
   * Transcribe a single WAV file. Returns segments with timestamps.
   * Calls scripts/transcribe.py as a subprocess.
   * Throws on script error; returns empty segments on silence.
   */
  async transcribeFile(wavPath: string): Promise<WhisperResult>

  /**
   * Transcribe all closed WAV chunks for a session, in chunk order.
   * Adjusts timestamps so they are relative to session start (not chunk start).
   * Returns all segments in chronological order.
   */
  async transcribeSession(
    sessionId: string,
    chunks: AudioChunkRecord[],
    sessionStartMs: number,
  ): Promise<WhisperSegment[]>
}
```

**Subprocess call:**

```typescript
import { spawn } from 'node:child_process';

// Resolve the venv python path
const pythonBin = path.join(venvDir, 'bin', 'python3');
// Falls back to system python3 if venv not found — log a warning

const child = spawn(pythonBin, [scriptPath, wavPath, '--model', model]);
// Collect stdout, parse JSON on exit
// timeout: 5 × chunk duration (base.en is ~1-2× real-time, give 5× headroom)
// On timeout: kill child, throw error
```

**Timestamp adjustment:** each WAV chunk's `start_ms` is stored in `audio_chunks`. Add `chunk.start_ms` to each segment's `start`/`end` to get session-relative timestamps.

**Python binary path:** `{DATA_DIR}/../venv-whisper/bin/python3` on Pi, or `python3` as fallback. Make this configurable via a new env var `FASTER_WHISPER_PYTHON` (default: `python3`).

---

## 4. VoiceComponent changes

In `VoiceComponent.stopSession()`:

```typescript
async stopSession(): Promise<void> {
  // 1. Stop the capture service (closes the current WAV chunk)
  await this.captureService.stop();

  // 2. If STT_PROVIDER=faster-whisper, run batch transcription
  if (this.config.stt.provider === 'faster-whisper') {
    await this.runBatchTranscription();
  }

  // 3. Normal stop logic continues...
}

private async runBatchTranscription(): Promise<void> {
  const chunks = this.repositories.audioChunks
    .listBySession(this.sessionId)
    .filter(c => c.status === 'closed' || c.status === 'repaired')
    .sort((a, b) => a.chunkIndex - b.chunkIndex);

  if (chunks.length === 0) {
    this.logger.warn('[voice] no closed chunks to transcribe');
    return;
  }

  this.logger.info(`[voice] batch transcribing ${chunks.length} chunks via faster-whisper`);

  const segments = await this.whisperProvider.transcribeSession(
    this.sessionId,
    chunks,
    this.sessionStartMs,
  );

  // Persist segments exactly as if they came from ElevenLabs
  for (const seg of segments) {
    const record: TranscriptSegmentRecord = {
      id: randomUUID(),
      sessionId: this.sessionId,
      sequence: this.nextSequence++,
      provider: 'faster-whisper',
      startMs: Math.round(seg.start * 1000),
      endMs: Math.round(seg.end * 1000),
      text: seg.text,
      speakerLabel: 'SPEAKER_0',   // faster-whisper base.en has no diarisation
      languageCode: 'en',
      confidence: 0.9,             // whisper doesn't give per-segment confidence
      rawJson: JSON.stringify(seg),
      committedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.repositories.transcriptSegments.insert(record);
  }

  this.logger.info(`[voice] batch transcription complete: ${segments.length} segments`);
}
```

**Note on diarisation:** faster-whisper `base.en` doesn't support speaker diarisation. All segments get `speakerLabel: 'SPEAKER_0'`. This is acceptable for the post-session batch path — the admin can upgrade to ElevenLabs (J7) for diarised output if needed. Document this clearly in the report.

---

## 5. Config additions

Add to `core/src/config.ts` (alongside existing `fasterWhisperModel` and `fasterWhisperScript`):

```typescript
FASTER_WHISPER_PYTHON: z.string().default('python3'),
FASTER_WHISPER_VENV_DIR: z.string().default(''),  // empty = use system python
FASTER_WHISPER_TIMEOUT_MULTIPLIER: z.coerce.number().default(5),  // × chunk duration
```

Add to `.env.example`:
```bash
# faster-whisper Python path
# Pi: /home/pistation/pi-station/venv-whisper/bin/python3
# Dev: python3 (system)
FASTER_WHISPER_PYTHON=python3
FASTER_WHISPER_VENV_DIR=
FASTER_WHISPER_TIMEOUT_MULTIPLIER=5
```

---

## 6. Status and report changes

**`GET /status`** — add to the `stt` section:

```json
"stt": {
  "provider": "faster-whisper",
  "connected": true,
  "batch_transcription": {
    "available": true,
    "model": "base.en",
    "status": "idle"  // idle | running | complete | error
  }
}
```

**Report** — when provider is `faster-whisper`, add a note in the report:

```
Transcript generated by faster-whisper (base.en) — local offline transcription.
Speaker diarisation not available in batch mode.
Upgrade available: re-process audio through ElevenLabs Scribe v2 for diarised output.
```

**Dashboard** — when `STT_PROVIDER=faster-whisper` and state is `STOPPING`, show a progress indicator: "Transcribing audio locally — this may take a few minutes."

---

## 7. Mock mode compatibility

When `STT_PROVIDER=mock`, `runBatchTranscription()` is never called. The mock transcript provider already populated segments during the session. Mock mode is completely unaffected.

When `STT_PROVIDER=faster-whisper` in development (Mac), `transcribeFile()` will fail if `python3` doesn't have `faster-whisper` installed. Handle gracefully: catch the error, log a clear message (`"faster-whisper not installed — install with: pip install faster-whisper"`), and store zero segments rather than crashing. The session still completes and the report still generates.

---

## 8. Tests

All tests must run without Python, without faster-whisper, without WAV files:

- `test/fasterWhisperProvider.test.ts`:
  - Mock the subprocess spawn — return a fake JSON response
  - `transcribeFile` parses JSON correctly
  - `transcribeFile` handles subprocess error gracefully (returns empty segments, does not throw)
  - `transcribeFile` handles timeout gracefully
  - `transcribeSession` adjusts timestamps correctly across multiple chunks (chunk 1 start_ms=0, chunk 2 start_ms=30000 → segment at 5s in chunk 2 becomes 35s)
  - `transcribeSession` returns segments in chronological order regardless of chunk order

- `test/voiceComponentBatchSTT.test.ts`:
  - `STT_PROVIDER=faster-whisper` → `stopSession()` calls `transcribeSession()`
  - Segments are persisted to `transcript_segments` with `provider='faster-whisper'`
  - `STT_PROVIDER=mock` → batch transcription NOT called
  - `STT_PROVIDER=elevenlabs` → batch transcription NOT called
  - Transcription failure (subprocess error) → session still completes, zero segments stored, error logged

**All 48 existing tests must still pass.**

---

## 9. Pi deployment

After building and testing locally:

```bash
npm run build
bash scripts/deploy-pi.sh pistation@pistation.local
```

Update the Pi's `.env`:
```bash
ssh pistation@pistation.local
nano ~/pi-station/.env
# Change: STT_PROVIDER=faster-whisper
# Add:    FASTER_WHISPER_PYTHON=/home/pistation/pi-station/venv-whisper/bin/python3
# Add:    FASTER_WHISPER_VENV_DIR=/home/pistation/pi-station/venv-whisper
```

Restart:
```bash
pm2 restart pi-station
```

**Smoke test on Pi:**
```bash
curl -X POST http://pistation.local:3456/start
# Speak for 30 seconds
curl -X POST http://pistation.local:3456/stop
# Wait for batch transcription to complete (~30-60s for 30s of audio on Pi 5)
curl http://pistation.local:3456/transcript
# Should return real transcribed segments
```

---

## 10. Done criteria

- [ ] `FasterWhisperProvider` in `apps/meet-station/src/capture/FasterWhisperProvider.ts`
- [ ] `VoiceComponent.stopSession()` calls batch transcription when `STT_PROVIDER=faster-whisper`
- [ ] Segments persisted with `provider='faster-whisper'`, timestamps session-relative
- [ ] Subprocess timeout handled gracefully
- [ ] `STT_PROVIDER=mock` and `STT_PROVIDER=elevenlabs` completely unaffected
- [ ] Config additions: `FASTER_WHISPER_PYTHON`, `FASTER_WHISPER_VENV_DIR`, `FASTER_WHISPER_TIMEOUT_MULTIPLIER`
- [ ] Status reflects batch transcription state
- [ ] Report notes the provider and upgrade path
- [ ] All 48 existing tests + all new tests green
- [ ] `npm run typecheck` clean, `npm run build` clean
- [ ] Deployed to Pi, real WAV transcribed to real segments
- [ ] Diary + project + job updated, committed, pushed

---

## 11. Close the loop

1. `npm run typecheck` + `npm run build` + `npm test` — all clean.
2. `devops/ai/diary.md` — what was built, confirmed Python path on Pi, sample transcription output.
3. `devops/ai/project.md` — append run report.
4. `devops/ai/job.md` — STATUS DONE. Next job: J6 (VideoComponent + AI HAT+ + pan/tilt).
5. `git commit -m "[pi-station] J5: FasterWhisperProvider — local batch STT post-session"` + push.
