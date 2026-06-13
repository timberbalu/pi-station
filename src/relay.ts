/**
 * pi-relay — outbound segment queue
 *
 * Listens for TranscriptSegment events from CaptureService.
 * Attempts to POST each segment to voice.apresmeet.com immediately.
 * On failure, writes to a local SQLite queue and retries with
 * exponential backoff. The server receives segments with their
 * original captured_at timestamps — the transcript is coherent
 * regardless of when segments actually arrive.
 */

import Database from 'better-sqlite3';
import { config } from './config.js';
import { captureService, type TranscriptSegment } from './capture.js';

interface QueuedSegment {
  id:          number;
  payload:     string; // JSON-serialised TranscriptSegment
  attempts:    number;
  next_retry:  number; // Unix ms
}

export class RelayService {
  private db:          Database.Database;
  private flushTimer:  ReturnType<typeof setInterval> | null = null;
  private paused = false;

  constructor() {
    this.db = new Database(config.buffer.sqlitePath);
    this._initDb();
  }

  start(): void {
    // Listen to capture events
    captureService.on('segment', (segment: TranscriptSegment) => {
      void this._deliver(segment);
    });

    // Periodic flush of queued segments
    this.flushTimer = setInterval(() => void this._flush(), 5_000);

    console.log('[relay] Started — watching for segments');
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.db.close();
    console.log('[relay] Stopped');
  }

  get queueDepth(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM queue').get() as { n: number };
    return row.n;
  }

  // ── private ──────────────────────────────────────────────────────────────

  private _initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        payload    TEXT    NOT NULL,
        attempts   INTEGER NOT NULL DEFAULT 0,
        next_retry INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  private async _deliver(segment: TranscriptSegment): Promise<void> {
    const ok = await this._post(segment);
    if (!ok) {
      this._enqueue(segment);
    }
  }

  private async _post(segment: TranscriptSegment): Promise<boolean> {
    if (!config.vi.ingestUrl || !config.vi.sessionToken) {
      // Dev mode — just log
      console.log('[relay] ▶ segment:', segment.text.slice(0, 60));
      return true;
    }

    try {
      const res = await fetch(config.vi.ingestUrl, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${config.vi.sessionToken}`,
        },
        body: JSON.stringify(segment),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) return true;
      console.warn('[relay] POST failed:', res.status);
      return false;
    } catch (err) {
      console.warn('[relay] POST error:', (err as Error).message);
      return false;
    }
  }

  private _enqueue(segment: TranscriptSegment): void {
    this.db
      .prepare('INSERT INTO queue (payload, attempts, next_retry) VALUES (?, 0, ?)')
      .run(JSON.stringify(segment), Date.now());
    console.log('[relay] Queued segment — queue depth:', this.queueDepth);
  }

  private async _flush(): Promise<void> {
    const now = Date.now();
    const rows = this.db
      .prepare('SELECT * FROM queue WHERE next_retry <= ? ORDER BY id ASC LIMIT 10')
      .all(now) as QueuedSegment[];

    for (const row of rows) {
      const segment = JSON.parse(row.payload) as TranscriptSegment;
      const ok = await this._post(segment);

      if (ok) {
        this.db.prepare('DELETE FROM queue WHERE id = ?').run(row.id);
      } else {
        // Exponential backoff: 5s, 10s, 20s, 40s … max 5 min
        const delay = Math.min(5_000 * Math.pow(2, row.attempts), 300_000);
        this.db
          .prepare('UPDATE queue SET attempts = ?, next_retry = ? WHERE id = ?')
          .run(row.attempts + 1, now + delay, row.id);
      }
    }

    if (rows.length > 0) {
      console.log(`[relay] Flush: ${rows.length} processed, ${this.queueDepth} remaining`);
    }
  }
}

export const relayService = new RelayService();
