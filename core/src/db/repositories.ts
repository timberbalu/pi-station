import Database from 'better-sqlite3';

import type {
  AudioChunkRecord,
  AudioChunkStatus,
  InsightMarkRecord,
  ManifestStatus,
  MediaPhaseStatus,
  MediaTransferRecord,
  MediaTransferStatus,
  MediaType,
  RelayQueueRecord,
  RelayQueueStatus,
  SegmentsStatus,
  SessionEventRecord,
  SessionRecord,
  StationState,
  SyncStateRecord,
  TranscriptSegmentRecord,
} from '../types.js';

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function mapSession(row: Record<string, unknown>): SessionRecord {
  return {
    id: String(row['id']),
    sessionCode: String(row['session_code']),
    title: String(row['title']),
    state: String(row['state']) as StationState,
    stationToken: String(row['station_token']),
    ingestUrl: String(row['ingest_url']),
    startedAt: row['started_at'] ? String(row['started_at']) : null,
    stoppedAt: row['stopped_at'] ? String(row['stopped_at']) : null,
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

function mapTranscript(row: Record<string, unknown>): TranscriptSegmentRecord {
  return {
    id: String(row['id']),
    sessionId: String(row['session_id']),
    sequence: Number(row['sequence']),
    provider: String(row['provider']),
    startMs: Number(row['start_ms']),
    endMs: Number(row['end_ms']),
    text: String(row['text']),
    speakerLabel: row['speaker_label'] ? String(row['speaker_label']) : null,
    languageCode: String(row['language_code']),
    confidence: Number(row['confidence']),
    raw: parseJson<Record<string, unknown>>(String(row['raw_json'])),
    committedAt: String(row['committed_at']),
    createdAt: String(row['created_at']),
  };
}

function mapRelayQueue(row: Record<string, unknown>): RelayQueueRecord {
  return {
    id: String(row['id']),
    sessionId: String(row['session_id']),
    segmentId: String(row['segment_id']),
    sequence: Number(row['sequence']),
    payloadJson: String(row['payload_json']),
    status: String(row['status']) as RelayQueueStatus,
    attempts: Number(row['attempts']),
    lastError: row['last_error'] ? String(row['last_error']) : null,
    nextAttemptAt: String(row['next_attempt_at']),
    sentAt: row['sent_at'] ? String(row['sent_at']) : null,
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

function mapAudioChunk(row: Record<string, unknown>): AudioChunkRecord {
  return {
    id: String(row['id']),
    sessionId: String(row['session_id']),
    chunkIndex: Number(row['chunk_index']),
    path: String(row['path']),
    startMs: Number(row['start_ms']),
    endMs: Number(row['end_ms']),
    bytes: Number(row['bytes']),
    sampleRate: Number(row['sample_rate']),
    channels: Number(row['channels']),
    status: String(row['status']) as AudioChunkStatus,
    createdAt: String(row['created_at']),
    closedAt: row['closed_at'] ? String(row['closed_at']) : null,
  };
}

function mapSessionEvent(row: Record<string, unknown>): SessionEventRecord {
  return {
    id: String(row['id']),
    sessionId: row['session_id'] ? String(row['session_id']) : null,
    type: String(row['type']),
    level: String(row['level']) as SessionEventRecord['level'],
    message: String(row['message']),
    payloadJson: String(row['payload_json']),
    createdAt: String(row['created_at']),
  };
}

function mapInsight(row: Record<string, unknown>): InsightMarkRecord {
  return {
    id: String(row['id']),
    sessionId: String(row['session_id']),
    atMs: Number(row['at_ms']),
    beforeMs: Number(row['before_ms']),
    afterMs: Number(row['after_ms']),
    note: row['note'] ? String(row['note']) : null,
    transcriptExcerpt: row['transcript_excerpt'] ? String(row['transcript_excerpt']) : null,
    createdAt: String(row['created_at']),
  };
}

function mapMediaTransfer(row: Record<string, unknown>): MediaTransferRecord {
  return {
    id: String(row['id']),
    sessionId: String(row['session_id']),
    mediaType: String(row['media_type']) as MediaType,
    filePath: String(row['file_path']),
    s3Key: String(row['s3_key']),
    chunkIndex: Number(row['chunk_index']),
    fileSize: Number(row['file_size']),
    s3UploadId: row['s3_upload_id'] ? String(row['s3_upload_id']) : null,
    partsJson: String(row['parts_json']),
    status: String(row['status']) as MediaTransferStatus,
    attempts: Number(row['attempts']),
    lastError: row['last_error'] ? String(row['last_error']) : null,
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

function mapSyncState(row: Record<string, unknown>): SyncStateRecord {
  return {
    sessionId: String(row['session_id']),
    manifestStatus: String(row['manifest_status']) as ManifestStatus,
    segmentsStatus: String(row['segments_status']) as SegmentsStatus,
    audioStatus: String(row['audio_status']) as MediaPhaseStatus,
    videoStatus: String(row['video_status']) as MediaPhaseStatus,
    syncComplete: Number(row['sync_complete']),
    lastSyncAt: row['last_sync_at'] ? String(row['last_sync_at']) : null,
    lastError: row['last_error'] ? String(row['last_error']) : null,
    updatedAt: String(row['updated_at']),
  };
}

export class StationConfigRepository {
  constructor(private readonly db: Database.Database) {}

  set(key: string, value: string, updatedAt: string): void {
    this.db.prepare(`
      INSERT INTO station_config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, updatedAt);
  }
}

export class SessionsRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: SessionRecord): void {
    this.db.prepare(`
      INSERT INTO sessions (id, session_code, title, state, station_token, ingest_url, started_at, stopped_at, created_at, updated_at)
      VALUES (@id, @sessionCode, @title, @state, @stationToken, @ingestUrl, @startedAt, @stoppedAt, @createdAt, @updatedAt)
    `).run(record);
  }

  updateState(sessionId: string, state: StationState, updatedAt: string): void {
    this.db.prepare('UPDATE sessions SET state = ?, updated_at = ? WHERE id = ?').run(state, updatedAt, sessionId);
  }

  markStarted(sessionId: string, startedAt: string, updatedAt: string): void {
    this.db.prepare('UPDATE sessions SET started_at = ?, updated_at = ?, state = ? WHERE id = ?')
      .run(startedAt, updatedAt, 'RECORDING', sessionId);
  }

  markStopped(sessionId: string, stoppedAt: string, updatedAt: string, state: StationState): void {
    this.db.prepare('UPDATE sessions SET stopped_at = ?, updated_at = ?, state = ? WHERE id = ?')
      .run(stoppedAt, updatedAt, state, sessionId);
  }

  getById(sessionId: string): SessionRecord | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as Record<string, unknown> | undefined;
    return row ? mapSession(row) : null;
  }
}

export class TranscriptSegmentsRepository {
  constructor(private readonly db: Database.Database) {}

  insert(record: TranscriptSegmentRecord): boolean {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO transcript_segments (
        id, session_id, sequence, provider, start_ms, end_ms, text, speaker_label, language_code, confidence, raw_json, committed_at, created_at
      ) VALUES (
        @id, @sessionId, @sequence, @provider, @startMs, @endMs, @text, @speakerLabel, @languageCode, @confidence, @rawJson, @committedAt, @createdAt
      )
    `).run({
      ...record,
      rawJson: JSON.stringify(record.raw),
    });

    return result.changes > 0;
  }

  listBySession(sessionId: string): TranscriptSegmentRecord[] {
    const rows = this.db.prepare('SELECT * FROM transcript_segments WHERE session_id = ? ORDER BY sequence ASC')
      .all(sessionId) as Record<string, unknown>[];
    return rows.map(mapTranscript);
  }

  listWindow(sessionId: string, fromMs: number, toMs: number): TranscriptSegmentRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM transcript_segments
      WHERE session_id = ? AND end_ms >= ? AND start_ms <= ?
      ORDER BY sequence ASC
    `).all(sessionId, fromMs, toMs) as Record<string, unknown>[];
    return rows.map(mapTranscript);
  }
}

export class RelayQueueRepository {
  constructor(private readonly db: Database.Database) {}

  enqueue(record: RelayQueueRecord): boolean {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO relay_queue (
        id, session_id, segment_id, sequence, payload_json, status, attempts, last_error, next_attempt_at, sent_at, created_at, updated_at
      ) VALUES (
        @id, @sessionId, @segmentId, @sequence, @payloadJson, @status, @attempts, @lastError, @nextAttemptAt, @sentAt, @createdAt, @updatedAt
      )
    `).run(record);
    return result.changes > 0;
  }

  getReady(limit: number, now: string): RelayQueueRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM relay_queue
      WHERE status = 'pending' AND next_attempt_at <= ?
      ORDER BY sequence ASC
      LIMIT ?
    `).all(now, limit) as Record<string, unknown>[];
    return rows.map(mapRelayQueue);
  }

  getPending(limit: number): RelayQueueRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM relay_queue
      WHERE status = 'pending'
      ORDER BY sequence ASC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];
    return rows.map(mapRelayQueue);
  }

  markSending(id: string, updatedAt: string): void {
    this.db.prepare('UPDATE relay_queue SET status = ?, updated_at = ? WHERE id = ?')
      .run('sending', updatedAt, id);
  }

  markPending(id: string, attempts: number, nextAttemptAt: string, lastError: string, updatedAt: string): void {
    this.db.prepare(`
      UPDATE relay_queue
      SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `).run('pending', attempts, nextAttemptAt, lastError, updatedAt, id);
  }

  markSent(id: string, sentAt: string, updatedAt: string): void {
    this.db.prepare(`
      UPDATE relay_queue
      SET status = ?, sent_at = ?, updated_at = ?, last_error = NULL
      WHERE id = ?
    `).run('sent', sentAt, updatedAt, id);
  }

  markDead(id: string, attempts: number, lastError: string, updatedAt: string): void {
    this.db.prepare(`
      UPDATE relay_queue
      SET status = ?, attempts = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `).run('dead', attempts, lastError, updatedAt, id);
  }

  countByStatus(status: RelayQueueStatus): number {
    const row = this.db.prepare('SELECT COUNT(*) as total FROM relay_queue WHERE status = ?').get(status) as { total: number };
    return row.total;
  }

  countBySession(sessionId: string, status: RelayQueueStatus): number {
    const row = this.db.prepare('SELECT COUNT(*) as total FROM relay_queue WHERE session_id = ? AND status = ?')
      .get(sessionId, status) as { total: number };
    return row.total;
  }
}

export class AudioChunksRepository {
  constructor(private readonly db: Database.Database) {}

  open(record: AudioChunkRecord): void {
    this.db.prepare(`
      INSERT INTO audio_chunks (
        id, session_id, chunk_index, path, start_ms, end_ms, bytes, sample_rate, channels, status, created_at, closed_at
      ) VALUES (
        @id, @sessionId, @chunkIndex, @path, @startMs, @endMs, @bytes, @sampleRate, @channels, @status, @createdAt, @closedAt
      )
    `).run(record);
  }

  updateProgress(id: string, bytes: number, endMs: number): void {
    this.db.prepare('UPDATE audio_chunks SET bytes = ?, end_ms = ? WHERE id = ?').run(bytes, endMs, id);
  }

  close(id: string, bytes: number, endMs: number, status: AudioChunkStatus, closedAt: string): void {
    this.db.prepare(`
      UPDATE audio_chunks
      SET bytes = ?, end_ms = ?, status = ?, closed_at = ?
      WHERE id = ?
    `).run(bytes, endMs, status, closedAt, id);
  }

  getOpenChunks(): AudioChunkRecord[] {
    const rows = this.db.prepare('SELECT * FROM audio_chunks WHERE status = ?').all('open') as Record<string, unknown>[];
    return rows.map(mapAudioChunk);
  }

  listBySession(sessionId: string): AudioChunkRecord[] {
    const rows = this.db.prepare('SELECT * FROM audio_chunks WHERE session_id = ? ORDER BY chunk_index ASC')
      .all(sessionId) as Record<string, unknown>[];
    return rows.map(mapAudioChunk);
  }
}

export class SessionEventsRepository {
  constructor(private readonly db: Database.Database) {}

  insert(record: SessionEventRecord): void {
    this.db.prepare(`
      INSERT INTO session_events (id, session_id, type, level, message, payload_json, created_at)
      VALUES (@id, @sessionId, @type, @level, @message, @payloadJson, @createdAt)
    `).run(record);
  }

  listRecent(limit: number): SessionEventRecord[] {
    const rows = this.db.prepare('SELECT * FROM session_events ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map(mapSessionEvent);
  }

  countByType(type: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM session_events WHERE type = ?').get(type) as { total: number };
    return row.total;
  }
}

export class InsightMarksRepository {
  constructor(private readonly db: Database.Database) {}

  insert(record: InsightMarkRecord): void {
    this.db.prepare(`
      INSERT INTO insight_marks (id, session_id, at_ms, before_ms, after_ms, note, transcript_excerpt, created_at)
      VALUES (@id, @sessionId, @atMs, @beforeMs, @afterMs, @note, @transcriptExcerpt, @createdAt)
    `).run(record);
  }

  listBySession(sessionId: string): InsightMarkRecord[] {
    const rows = this.db.prepare('SELECT * FROM insight_marks WHERE session_id = ? ORDER BY at_ms ASC')
      .all(sessionId) as Record<string, unknown>[];
    return rows.map(mapInsight);
  }
}

export class SyncStateRepository {
  constructor(private readonly db: Database.Database) {}

  /** Returns the existing row, creating a default pending row if absent. */
  ensure(sessionId: string, now: string): SyncStateRecord {
    this.db.prepare(`
      INSERT OR IGNORE INTO sync_state (session_id, updated_at)
      VALUES (?, ?)
    `).run(sessionId, now);
    return this.get(sessionId) as SyncStateRecord;
  }

  get(sessionId: string): SyncStateRecord | null {
    const row = this.db.prepare('SELECT * FROM sync_state WHERE session_id = ?')
      .get(sessionId) as Record<string, unknown> | undefined;
    return row ? mapSyncState(row) : null;
  }

  setManifest(sessionId: string, status: ManifestStatus, now: string): void {
    this.db.prepare('UPDATE sync_state SET manifest_status = ?, updated_at = ? WHERE session_id = ?')
      .run(status, now, sessionId);
  }

  setSegments(sessionId: string, status: SegmentsStatus, now: string): void {
    this.db.prepare('UPDATE sync_state SET segments_status = ?, updated_at = ? WHERE session_id = ?')
      .run(status, now, sessionId);
  }

  setAudio(sessionId: string, status: MediaPhaseStatus, now: string): void {
    this.db.prepare('UPDATE sync_state SET audio_status = ?, updated_at = ? WHERE session_id = ?')
      .run(status, now, sessionId);
  }

  setVideo(sessionId: string, status: MediaPhaseStatus, now: string): void {
    this.db.prepare('UPDATE sync_state SET video_status = ?, updated_at = ? WHERE session_id = ?')
      .run(status, now, sessionId);
  }

  markComplete(sessionId: string, now: string): void {
    this.db.prepare('UPDATE sync_state SET sync_complete = 1, last_sync_at = ?, last_error = NULL, updated_at = ? WHERE session_id = ?')
      .run(now, now, sessionId);
  }

  setError(sessionId: string, error: string, now: string): void {
    this.db.prepare('UPDATE sync_state SET last_error = ?, updated_at = ? WHERE session_id = ?')
      .run(error, now, sessionId);
  }

  touch(sessionId: string, now: string): void {
    this.db.prepare('UPDATE sync_state SET last_sync_at = ?, updated_at = ? WHERE session_id = ?')
      .run(now, now, sessionId);
  }
}

export class MediaTransferRepository {
  constructor(private readonly db: Database.Database) {}

  /** Idempotent enqueue keyed on (session_id, media_type, chunk_index). */
  enqueue(record: MediaTransferRecord): boolean {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO media_transfer_queue (
        id, session_id, media_type, file_path, s3_key, chunk_index, file_size,
        s3_upload_id, parts_json, status, attempts, last_error, created_at, updated_at
      ) VALUES (
        @id, @sessionId, @mediaType, @filePath, @s3Key, @chunkIndex, @fileSize,
        @s3UploadId, @partsJson, @status, @attempts, @lastError, @createdAt, @updatedAt
      )
    `).run(record);
    return result.changes > 0;
  }

  getById(id: string): MediaTransferRecord | null {
    const row = this.db.prepare('SELECT * FROM media_transfer_queue WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapMediaTransfer(row) : null;
  }

  listBySession(sessionId: string, mediaType: MediaType): MediaTransferRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM media_transfer_queue
      WHERE session_id = ? AND media_type = ?
      ORDER BY chunk_index ASC
    `).all(sessionId, mediaType) as Record<string, unknown>[];
    return rows.map(mapMediaTransfer);
  }

  setPresign(id: string, uploadId: string, now: string): void {
    this.db.prepare(`
      UPDATE media_transfer_queue
      SET s3_upload_id = ?, status = 'uploading', updated_at = ?
      WHERE id = ?
    `).run(uploadId, now, id);
  }

  setParts(id: string, partsJson: string, status: MediaTransferStatus, now: string): void {
    this.db.prepare('UPDATE media_transfer_queue SET parts_json = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(partsJson, status, now, id);
  }

  markUploaded(id: string, partsJson: string, now: string): void {
    this.db.prepare(`
      UPDATE media_transfer_queue
      SET parts_json = ?, status = 'uploaded', last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(partsJson, now, id);
  }

  markError(id: string, attempts: number, lastError: string, now: string): void {
    this.db.prepare(`
      UPDATE media_transfer_queue
      SET status = 'error', attempts = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(attempts, lastError, now, id);
  }

  countBySessionStatus(sessionId: string, mediaType: MediaType, status: MediaTransferStatus): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total FROM media_transfer_queue
      WHERE session_id = ? AND media_type = ? AND status = ?
    `).get(sessionId, mediaType, status) as { total: number };
    return row.total;
  }
}

export function createRepositories(db: Database.Database) {
  return {
    stationConfig: new StationConfigRepository(db),
    sessions: new SessionsRepository(db),
    transcriptSegments: new TranscriptSegmentsRepository(db),
    relayQueue: new RelayQueueRepository(db),
    audioChunks: new AudioChunksRepository(db),
    sessionEvents: new SessionEventsRepository(db),
    insightMarks: new InsightMarksRepository(db),
    syncState: new SyncStateRepository(db),
    mediaTransfer: new MediaTransferRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
