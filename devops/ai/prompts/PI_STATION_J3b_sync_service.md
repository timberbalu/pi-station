# PI_STATION_J3b — Sync Service: offline-to-online transition via S3

> **This job sits between J3 (component platform) and J4 (apm ingest receiver).** J3 must land first because SyncService is a host-level concern. J4 must implement the presigned URL and manifest endpoints this job defines. Read J3 first, then this prompt.
>
> **Read first:** `devops/ai/START_HERE.md`, `devops/ai/diary.md`, `devops/ai/memory.md`.
>
> **Key architectural fact from the ecosystem docs:** ApresMeet already uses AWS S3 for media storage (audio, images, transcripts). S3 + CloudFront is the established pattern. Voice and video chunks go to S3, not through the PHP application server. The PHP server only handles small coordination requests (presigned URLs, manifest, confirmation). Never stream large binaries through Elastic Beanstalk.

---

## 1. Why S3, and why presigned URLs

Elastic Beanstalk is not built for large binary streaming. Uploading WAV and video files through `voice.apresmeet.com` would hammer EB web workers with slow, multi-megabyte transfers — creating a bottleneck that has nothing to do with application logic and would consume server resources needed for real requests.

The correct pattern — which is how ApresMeet already handles media — is **presigned S3 URLs**:

```
WRONG (naive, don't do this):
Pi → [5MB WAV chunk] → voice.apresmeet.com (PHP/EB) → S3
                              ↑ hammers EB

CORRECT (presigned URL pattern):
Pi → POST /station/sessions/:id/media/presign  →  voice.apresmeet.com  (tiny)
voice.apresmeet.com generates presigned S3 URL  →  returns to Pi
Pi → [5MB WAV chunk] → S3 directly (EB not involved in the upload at all)
Pi → POST /station/sessions/:id/media/confirm  →  voice.apresmeet.com  (tiny)
```

The PHP server handles only two small requests per chunk. S3 absorbs all the binary traffic. CloudFront can then serve the stored files directly to CoCo, MeetPaper, and the admin.

---

## 2. S3 bucket structure

All VI media lives under a single prefix, structured so CoCo, ElevenLabs re-processing, and MeetPaper can all find what they need by session ID:

```
vi-media/
  sessions/
    {session_id}/
      manifest.json               ← session metadata (written by apm on sync-complete)
      audio/
        chunk-0001.wav            ← rolling 30s WAV chunks from pi-capture
        chunk-0002.wav
        ...
        session-full.wav          ← optional: assembled after all chunks confirmed
      video/
        chunk-0001.mp4            ← rolling video chunks from VideoComponent (J6)
        chunk-0002.mp4
        ...
      transcripts/
        whisper-{timestamp}.txt   ← local Whisper output (J5), stored after upload
        scribe-{timestamp}.txt    ← ElevenLabs upgrade output (J7), if admin triggered
```

S3 key naming: `vi-media/sessions/{session_id}/audio/chunk-{NNNN}.wav`. Zero-padded 4-digit index. This ensures lexicographic sort = chronological order, which matters for assembly and CoCo processing.

---

## 3. Sync phases (revised for S3)

The four-phase protocol from the original J3b design stands, with Phase 3 now using S3 multipart upload rather than chunked HTTP:

```
Phase 1 — Session manifest  (tiny JSON to PHP server)
  POST /station/sessions
  PHP creates session record in MySQL, returns { accepted: true }
  Gate: nothing else syncs until manifest confirmed
  Idempotent: sending twice is safe (PHP upserts on session_id)

Phase 2 — Transcript segments  (existing RelayService, unchanged)
  Small JSON payloads, individually idempotent, ordered by sequence
  Already implemented — just gate it on Phase 1 completing
  Done when relay_queue depth = 0 for this session

Phase 3 — Media files to S3  (presigned URL + S3 multipart)
  For each audio/video chunk file on disk:
    3a. GET  /station/sessions/:id/media/presign?key=audio/chunk-0001.wav
         → { upload_id, presigned_parts: [{part_number, presigned_url}, ...] }
    3b. PUT each part directly to S3 using presigned_url
         → collect ETag from each part response header
    3c. POST /station/sessions/:id/media/confirm
         { key, upload_id, parts: [{part_number, etag}, ...] }
         PHP calls s3->completeMultipartUpload()
         → { confirmed: true, s3_key }
  Store upload_id + confirmed parts in media_transfer_queue for resumability
  Starts only after Phase 2 complete (transcript in VI before media arrives)

Phase 4 — Sync complete  (tiny JSON to PHP server)
  POST /station/sessions/:id/sync-complete
  PHP marks session fully received; triggers CoCo pipeline if auto-process enabled
  Pi marks sync_complete = 1 in local sync_state
  Dashboard: "Synced ✓"
```

---

## 4. Resumability via S3 multipart upload IDs

S3 multipart upload is the native solution to "resume from where you left off." You do not need to track `bytes_sent` in your own table — S3's upload ID is the resume token.

```sql
CREATE TABLE IF NOT EXISTS media_transfer_queue (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  media_type      TEXT NOT NULL,      -- 'audio' | 'video'
  file_path       TEXT NOT NULL,      -- absolute path on Pi disk
  s3_key          TEXT NOT NULL,      -- vi-media/sessions/.../audio/chunk-0001.wav
  chunk_index     INTEGER NOT NULL,
  file_size       INTEGER NOT NULL,
  s3_upload_id    TEXT,               -- S3 multipart upload ID (resume token)
  parts_json      TEXT,               -- JSON array of {part_number, etag} confirmed so far
  status          TEXT NOT NULL DEFAULT 'pending',
    -- pending | presign_requested | uploading | confirming | uploaded | error | skipped
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(session_id, media_type, chunk_index)
);
```

On reconnect after a dropped upload: if `s3_upload_id` is set and `parts_json` has confirmed parts, request presigned URLs only for the remaining parts (part_number > max confirmed part) and continue from there. S3 keeps the multipart upload alive for 7 days by default — plenty of time for any realistic offline window.

---

## 5. Sync state table (unchanged from original J3b)

```sql
CREATE TABLE IF NOT EXISTS sync_state (
  session_id          TEXT PRIMARY KEY,
  manifest_status     TEXT NOT NULL DEFAULT 'pending',
    -- pending | confirmed | failed
  segments_status     TEXT NOT NULL DEFAULT 'pending',
    -- pending | in_progress | synced
  audio_status        TEXT NOT NULL DEFAULT 'pending',
    -- pending | in_progress | complete | skipped
  video_status        TEXT NOT NULL DEFAULT 'pending',
    -- pending | in_progress | complete | skipped
  sync_complete       INTEGER NOT NULL DEFAULT 0,
  last_sync_at        TEXT,
  last_error          TEXT,
  updated_at          TEXT NOT NULL
);
```

---

## 6. SyncService (`src/sync/SyncService.ts`)

Host-level service alongside RelayService. Orchestrates all four phases.

```ts
export class SyncService {
  async runSyncCycle(sessionId: string): Promise<void>
    // Executes phases in order; each phase checks its own status before running
    // If any phase fails, logs and stops — next cycle picks up from the failed phase

  async syncOnStop(sessionId: string): Promise<void>
    // Best-effort sync called by StationApp.stop()
    // Runs one full cycle synchronously before report generation

  getSyncStatus(sessionId: string): SyncStatus
    // For /status endpoint and dashboard

  private async phase1_manifest(session): Promise<boolean>
  private async phase2_segments(session): Promise<boolean>
  private async phase3_media(session): Promise<boolean>
    // For each file: presign → upload parts to S3 → confirm
    // Resumable via upload_id in media_transfer_queue
  private async phase4_complete(session): Promise<boolean>
}
```

S3 multipart upload in Node.js via the AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`). The Pi uses presigned URLs — it never holds AWS credentials directly. The PHP server generates presigned URLs using its own AWS credentials (which it already has for existing S3 usage). The Pi is credential-free.

---

## 7. ConnectivityProbe (`src/sync/ConnectivityProbe.ts`)

Lightweight health probe that drives the `OFFLINE_BUFFERING → SYNCING` transition as a real network signal, not an inferred state.

```ts
export class ConnectivityProbe {
  // Polls VOICE_INGEST_URL/health every 10s when in OFFLINE_BUFFERING state
  // Emits 'online' event when first success after offline period
  // Emits 'offline' event when first failure after online period
  // StationApp subscribes: 'online' → syncService.runSyncCycle()
}
```

Simple HEAD or GET to a `/health` endpoint — no auth, no body. If it returns 2xx, the connection is back.

---

## 8. Endpoint contracts (for J4 to implement on the apm side)

These are the exact endpoints J4 must build. Document them here so J4 has a precise spec.

### Session manifest
```
POST /ws/station/sessions
Authorization: Bearer {station_token}
{ session_id, session_code, title, station_id, started_at, stopped_at, components: ['voice','video'] }
→ 200: { accepted: true, session_id }
→ 409: { accepted: true, existing: true }   (idempotent)
```

### Presign request
```
GET /ws/station/sessions/:sessionId/media/presign
    ?key=audio/chunk-0001.wav
    &file_size=5242880
    &part_size=5242880
Authorization: Bearer {station_token}
→ 200: {
    upload_id: "abc123",
    parts: [
      { part_number: 1, presigned_url: "https://s3.amazonaws.com/...signed..." },
      ...
    ]
  }
```
PHP generates this using `Aws\S3\S3Client::createPresignedRequest()`. The bucket and prefix are server-side config — the Pi never knows them.

### Upload confirm
```
POST /ws/station/sessions/:sessionId/media/confirm
Authorization: Bearer {station_token}
{ key, upload_id, parts: [{ part_number, etag }, ...] }
→ 200: { confirmed: true, s3_key: "vi-media/sessions/{id}/audio/chunk-0001.wav" }
```
PHP calls `completeMultipartUpload`, records `s3_key` in `VI_MEDIA_ASSETS` table (new).

### Sync complete
```
POST /ws/station/sessions/:sessionId/sync-complete
Authorization: Bearer {station_token}
{ components_synced: ['voice', 'video'] }
→ 200: { ok: true }
```
PHP marks session `sync_complete = 1`, fires a CoCo pipeline trigger if auto-processing is enabled.

---

## 9. New apm-side table (for J4)

```sql
CREATE TABLE VI_MEDIA_ASSETS (
  ASSET_ID        VARCHAR(36)  NOT NULL,  -- UUID
  SESSION_ID      VARCHAR(36)  NOT NULL,
  MEDIA_TYPE      VARCHAR(10)  NOT NULL,  -- 'audio' | 'video' | 'transcript'
  CHUNK_INDEX     INT          NOT NULL,
  S3_KEY          VARCHAR(500) NOT NULL,
  FILE_SIZE       BIGINT       NOT NULL,
  STATUS          VARCHAR(20)  NOT NULL DEFAULT 'pending',
    -- pending | uploaded | processed | error
  UPLOADED_AT     DATETIME,
  CREATED_AT      DATETIME     NOT NULL,
  PRIMARY KEY (ASSET_ID),
  UNIQUE KEY uq_session_media (SESSION_ID, MEDIA_TYPE, CHUNK_INDEX)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

This table is what CoCo reads to find media for a session. It's also what the admin upgrade path (J7) reads to trigger ElevenLabs re-processing on the correct S3 audio key.

---

## 10. Dashboard — SYNCING state

```
SYNCING — Founder Fundraising Panel
  ✓  Session manifest          confirmed
  ↻  Transcript segments       38 / 52 delivered
  ○  Audio → S3               pending (starts after transcript)
      chunk-0001.wav  ✓  uploaded
      chunk-0002.wav  ↻  uploading  (part 2/3)
      chunk-0003.wav  ○  pending
  ○  Video → S3               pending (starts after audio)
  ○  Sync complete             pending
```

Each layer is visible. The organiser watches real progress. When all phases confirm: `REPORT_READY` with `Synced ✓`. The dashboard never needs to know the actual S3 URLs — just the status from `GET /status`.

---

## 11. Mock mode

In mock mode (`ENABLE_MOCK_INGEST=true`): the presign endpoint returns fake presigned URLs pointing to `/mock/s3/upload/:key`; the confirm endpoint accepts without calling real S3; the sync-complete endpoint sets the flag. The full four-phase sync story — including visible phase progress in the dashboard — must be demonstrable with zero real AWS infrastructure.

---

## 12. AWS SDK dependency

Add to `package.json` dependencies:
```json
"@aws-sdk/client-s3": "^3.x",
"@aws-sdk/s3-request-presigner": "^3.x"
```

The Pi never holds AWS credentials. All S3 operations are via presigned URLs obtained from the PHP server. The AWS SDK is used only to construct the presigned PUT requests, not to authenticate to AWS directly. Set `AWS_REGION=eu-west-2` (London) to match your RDS/EB region.

---

## 13. Tests

- `test/syncPhases.test.ts`: phases execute in order; phase 2 does not start until phase 1 complete; phase 3 does not start until phase 2 complete.
- `test/syncResumable.test.ts`: begin multipart upload; record upload_id + 1 confirmed part; simulate drop; reconnect; assert resumes from part 2, not from part 1.
- `test/manifestIdempotent.test.ts`: send manifest twice; second returns `existing: true`; one session row in DB.
- `test/connectivityProbe.test.ts`: probe fires 'online' event on first success after offline; fires 'offline' on first failure after online; does not fire repeatedly for sustained state.
- Mock S3 endpoints work throughout all tests (no real AWS needed).

---

## 14. Done criteria

1. `sync_state` and `media_transfer_queue` tables in migrations, typed repositories present.
2. SyncService runs full four-phase cycle on reconnect; phases in order; each gated on previous.
3. Phase 3 uses presigned URL pattern — Pi never calls S3 directly with AWS credentials.
4. Multipart upload resumable by upload_id + confirmed parts stored in `media_transfer_queue`.
5. ConnectivityProbe drives OFFLINE_BUFFERING → SYNCING transition as a real network signal.
6. Dashboard SYNCING banner shows per-phase progress including per-chunk audio/video status.
7. Mock sync works end to end with /simulate/network/down + /simulate/network/up.
8. J4 endpoint contracts documented precisely (§8); apm-side `VI_MEDIA_ASSETS` table defined (§9).
9. All new tests pass; existing tests unchanged.
10. AWS SDK added to package.json; Pi credential-free.
11. Diary + project + job updated; commit + push.

---

## 15. What this unlocks

```
Pi captures audio + video → offline → Whisper transcribes locally
Network returns → SyncService:
  → manifest confirms session in VI database
  → transcript segments delivered in order
  → audio chunks uploaded to S3 directly (EB not involved)
  → video chunks uploaded to S3 directly
  → sync-complete fires → CoCo picks up
CoCo reads from S3 → generates summary → MeetPaper publishes
Admin optionally: re-sends S3 audio key to ElevenLabs for quality upgrade
MeetPaper serves video via CloudFront (already in front of S3)
```

The Pi's job is done the moment sync-complete fires. Everything downstream is the cloud's problem.
