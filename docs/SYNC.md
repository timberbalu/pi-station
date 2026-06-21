# Sync Service — offline-to-online transition via S3

The Station captures locally and survives network drops. When the network returns,
`SyncService` moves everything to the cloud in four gated phases. Large binaries go
**straight to S3 via presigned URLs** — never streamed through the PHP/Elastic Beanstalk
app server. The Pi holds **no AWS credentials**.

## The four phases

```
Phase 1 — Session manifest   tiny JSON → apm; gates everything else (idempotent)
Phase 2 — Transcript segments existing relay queue drains to depth 0
Phase 3 — Media files to S3   presign → PUT parts directly to S3 → confirm (resumable)
Phase 4 — Sync complete       tiny JSON → apm; sets sync_complete = 1; CoCo can pick up
```

Each phase is gated on the previous. A failed phase stops the cycle; the next cycle
resumes from the failed phase. `runSyncCycle(sessionId)` runs the phases in order;
`syncOnStop(sessionId)` runs one best-effort cycle at stop, before report generation.

## Where it lives

| Module | Location | Role |
|---|---|---|
| `SyncService` | `core/src/sync/SyncService.ts` | Four-phase orchestrator (host-level) |
| `StationSyncClient` | `core/src/sync/StationSyncClient.ts` | HTTP to apm: manifest/presign/confirm/complete |
| `MediaUploader` | `core/src/sync/MediaUploader.ts` | Resumable multipart upload via presigned URLs |
| `ConnectivityProbe` | `core/src/sync/ConnectivityProbe.ts` | Real network signal driving OFFLINE→SYNCING |
| `sync_state`, `media_transfer_queue` | `core/src/db/migrations.ts` | Local sync bookkeeping |

## Resumability

S3 multipart upload IDs are the resume token — we do not track `bytes_sent`. After a
dropped upload, `media_transfer_queue` holds the `s3_upload_id` and the confirmed
`parts_json`. On the next cycle, `MediaUploader` requests presigned URLs only for parts
with `part_number` greater than the highest confirmed part, and continues. S3 keeps a
multipart upload alive for 7 days by default.

## S3 layout

```
vi-media/sessions/{session_id}/
  manifest.json
  audio/chunk-0001.wav          ← 4-digit zero-padded; lexicographic = chronological
  video/chunk-0001.mp4          ← J6
  transcripts/whisper-*.txt     ← J5 / J7
```

## Mock mode

With `ENABLE_MOCK_INGEST=true`, the Pi hosts the apm endpoints itself at `/mock/station/*`
and a mock S3 PUT target at `/mock/s3/upload`. The full four-phase story — including
per-chunk progress in the dashboard — runs with zero AWS infrastructure. All mock
endpoints honour the simulated-network flag, so `/simulate/network/down` breaks sync
exactly like a real outage. Production sets `STATION_SYNC_URL=https://voice.apresmeet.com/ws/station`.

---

## J4 — endpoints the apm (PHP) side must implement

`STATION_SYNC_URL` is the base. In production it is `https://voice.apresmeet.com/ws/station`.

### Session manifest
```
POST {base}/sessions
Authorization: Bearer {station_token}
{ session_id, session_code, title, station_id, started_at, stopped_at, components: ['voice'] }
→ 200: { accepted: true, existing: false }
→ 409: { accepted: true, existing: true }     # idempotent (upsert on session_id)
```

### Presign request
```
GET {base}/sessions/:sessionId/media/presign
    ?key=audio/chunk-0001.wav&file_size=5242880&part_size=5242880
    [&upload_id=...&from_part=2]               # resume: only remaining parts
Authorization: Bearer {station_token}
→ 200: { upload_id, parts: [{ part_number, presigned_url }, ...] }
```
PHP builds these with `Aws\S3\S3Client::createPresignedRequest()`. The bucket/prefix are
server-side config; the Pi never knows them. On resume (`upload_id` + `from_part`), reuse
the existing multipart upload and return URLs for `part_number >= from_part` only.

### Upload confirm
```
POST {base}/sessions/:sessionId/media/confirm
Authorization: Bearer {station_token}
{ key, upload_id, parts: [{ part_number, etag }, ...] }
→ 200: { confirmed: true, s3_key: "vi-media/sessions/{id}/audio/chunk-0001.wav" }
```
PHP calls `completeMultipartUpload`, records `s3_key` in `VI_MEDIA_ASSETS`.

### Sync complete
```
POST {base}/sessions/:sessionId/sync-complete
Authorization: Bearer {station_token}
{ components_synced: ['voice'] }
→ 200: { ok: true }
```
PHP marks session `sync_complete = 1`; fires a CoCo pipeline trigger if auto-process is on.

### apm-side table (J4)
```sql
CREATE TABLE VI_MEDIA_ASSETS (
  ASSET_ID    VARCHAR(36)  NOT NULL,
  SESSION_ID  VARCHAR(36)  NOT NULL,
  MEDIA_TYPE  VARCHAR(10)  NOT NULL,   -- 'audio' | 'video' | 'transcript'
  CHUNK_INDEX INT          NOT NULL,
  S3_KEY      VARCHAR(500) NOT NULL,
  FILE_SIZE   BIGINT       NOT NULL,
  STATUS      VARCHAR(20)  NOT NULL DEFAULT 'pending',  -- pending|uploaded|processed|error
  UPLOADED_AT DATETIME,
  CREATED_AT  DATETIME     NOT NULL,
  PRIMARY KEY (ASSET_ID),
  UNIQUE KEY uq_session_media (SESSION_ID, MEDIA_TYPE, CHUNK_INDEX)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```
This is what CoCo reads to find a session's media, and what the J7 admin upgrade path
reads to re-submit the S3 audio key to ElevenLabs.
