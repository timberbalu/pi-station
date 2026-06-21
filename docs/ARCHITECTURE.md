# MeetPaper Station Architecture

MeetPaper Station is split into three operational concerns:

1. `capture/` continuously writes local WAV chunks and best-effort transcript traffic.
2. `relay/` persists committed segments in SQLite and delivers them in sequence order.
3. `control/` exposes the local dashboard, control API, mock ingest, and simulation endpoints.

## State Machine

`IDLE -> PAIRING -> READY -> RECORDING -> OFFLINE_BUFFERING -> SYNCING -> RECORDING`

Additional states:

- `PAUSED`
- `STOPPING`
- `REPORT_READY`
- `ERROR`

## Data Model

- `sessions`
- `transcript_segments`
- `relay_queue`
- `audio_chunks`
- `session_events`
- `insight_marks`
- `station_config`

## ElevenLabs assumptions

The ElevenLabs realtime adapter is isolated behind `ElevenLabsRealtimeProvider.ts`. The MVP assumes:

- Realtime endpoint: `wss://api.elevenlabs.io/v1/speech-to-text/stream`
- `xi-api-key` header authentication
- PCM `pcm_s16le` audio at 16kHz mono
- Partial frames carry text-like fields and final frames can be detected by `is_final` or a similar final-type marker

Mock mode remains the default and the live adapter is intentionally isolated so that an API wire change does not break the demo path.
