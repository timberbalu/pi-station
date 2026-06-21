import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS station_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      session_code TEXT NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      station_token TEXT NOT NULL,
      ingest_url TEXT NOT NULL,
      started_at TEXT,
      stopped_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transcript_segments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      provider TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      text TEXT NOT NULL,
      speaker_label TEXT,
      language_code TEXT NOT NULL,
      confidence REAL NOT NULL,
      raw_json TEXT NOT NULL,
      committed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(session_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS relay_queue (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      segment_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at TEXT NOT NULL,
      sent_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(session_id, segment_id)
    );

    CREATE TABLE IF NOT EXISTS audio_chunks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      path TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      sample_rate INTEGER NOT NULL,
      channels INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      closed_at TEXT,
      UNIQUE(session_id, chunk_index)
    );

    CREATE TABLE IF NOT EXISTS session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      type TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS insight_marks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      at_ms INTEGER NOT NULL,
      before_ms INTEGER NOT NULL,
      after_ms INTEGER NOT NULL,
      note TEXT,
      transcript_excerpt TEXT,
      created_at TEXT NOT NULL
    );
  `);
}
