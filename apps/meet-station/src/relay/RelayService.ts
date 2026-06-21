import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';

import type { PlatformConfig } from '@pi-station/core';
import type { Repositories } from '@pi-station/core';
import { nowIso } from '../types.js';
import type { IngestPayload, SessionSummary, TranscriptCommit, TranscriptSegmentRecord } from '../types.js';
import { StationEventBus } from '@pi-station/core';
import { IngestClient } from './IngestClient.js';

interface RelayCallbacks {
  onQueueBacklog: () => void;
  onQueueDrained: () => void;
}

export class RelayService {
  private flushTimer: NodeJS.Timeout | null = null;
  private session: SessionSummary | null = null;
  private sentSegments = 0;
  private lastFlushAt: string | null = null;

  constructor(
    private readonly config: PlatformConfig,
    private readonly repositories: Repositories,
    private readonly ingestClient: IngestClient,
    private readonly bus: StationEventBus,
    private readonly callbacks: RelayCallbacks,
    _log: Logger,
  ) {}

  start(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setInterval(() => {
      void this.flushOnce(false);
    }, this.config.relay.flushIntervalMs);
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  setSession(session: SessionSummary): void {
    this.session = session;
  }

  async handleCommittedSegment(commit: TranscriptCommit): Promise<void> {
    const now = nowIso();
    const transcriptRecord: TranscriptSegmentRecord = {
      ...commit,
      createdAt: now,
    };

    const inserted = this.repositories.transcriptSegments.insert(transcriptRecord);
    if (!inserted) {
      return;
    }

    const payload = this.toPayload(commit);
    const queueInserted = this.repositories.relayQueue.enqueue({
      id: randomUUID(),
      sessionId: commit.sessionId,
      segmentId: commit.id,
      sequence: commit.sequence,
      payloadJson: JSON.stringify(payload),
      status: 'pending',
      attempts: 0,
      lastError: null,
      nextAttemptAt: now,
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    });

    if (queueInserted) {
      this.bus.emitSessionEvent({
        sessionId: commit.sessionId,
        type: 'segment_enqueued',
        level: 'info',
        message: `Segment ${commit.sequence} enqueued for relay`,
      });
    }

    await this.flushOnce(true);
  }

  async flushOnce(force = true): Promise<void> {
    if (!this.session) {
      return;
    }

    const readyRows = force
      ? this.repositories.relayQueue.getPending(25)
      : this.repositories.relayQueue.getReady(25, nowIso());
    if (readyRows.length === 0) {
      if (this.getQueuedCount() === 0) {
        this.callbacks.onQueueDrained();
      }
      return;
    }

    this.bus.emitSessionEvent({
      sessionId: this.session.sessionId,
      type: 'queue_flush_started',
      level: 'info',
      message: `Flushing ${readyRows.length} queued segments`,
    });

    for (const row of readyRows) {
      const updatedAt = nowIso();
      this.repositories.relayQueue.markSending(row.id, updatedAt);
      const payload = JSON.parse(row.payloadJson) as IngestPayload;
      const result = await this.ingestClient.send(payload, this.session.stationToken);

      if (result.ok) {
        this.repositories.relayQueue.markSent(row.id, nowIso(), nowIso());
        this.sentSegments += 1;
        this.lastFlushAt = nowIso();
        this.bus.emitSessionEvent({
          sessionId: this.session.sessionId,
          type: 'relay_send_success',
          level: 'info',
          message: `Delivered segment ${row.sequence}`,
        });
      } else {
        const nextAttempts = row.attempts + 1;
        const message = result.error ?? 'Unknown relay failure';
        if (nextAttempts >= this.config.relay.maxAttempts) {
          this.repositories.relayQueue.markDead(row.id, nextAttempts, message, nowIso());
        } else {
          const delay = Math.min(
            this.config.relay.initialBackoffMs * (2 ** Math.max(0, row.attempts)),
            this.config.relay.maxBackoffMs,
          );
          this.repositories.relayQueue.markPending(
            row.id,
            nextAttempts,
            new Date(Date.now() + delay).toISOString(),
            message,
            nowIso(),
          );
        }

        this.callbacks.onQueueBacklog();
        this.bus.emitSessionEvent({
          sessionId: this.session.sessionId,
          type: 'relay_send_failed',
          level: 'warn',
          message,
        });
      }
    }

    this.bus.emitSessionEvent({
      sessionId: this.session.sessionId,
      type: 'queue_flush_completed',
      level: 'info',
      message: 'Queue flush completed',
      payload: { queued: this.getQueuedCount() },
    });

    if (this.getQueuedCount() === 0) {
      this.callbacks.onQueueDrained();
    }
  }

  getQueuedCount(): number {
    return this.repositories.relayQueue.countByStatus('pending')
      + this.repositories.relayQueue.countByStatus('sending');
  }

  getStatus() {
    return {
      ingestUrl: this.config.relay.ingestUrl,
      connected: this.ingestClient.isConnected(),
      queuedSegments: this.getQueuedCount(),
      sentSegments: this.sentSegments,
      deadSegments: this.repositories.relayQueue.countByStatus('dead'),
      lastFlushAt: this.lastFlushAt,
      lastError: this.ingestClient.getLastError(),
    };
  }

  private toPayload(commit: TranscriptCommit): IngestPayload {
    return {
      station_id: this.config.app.stationId,
      session_id: commit.sessionId,
      segment_id: commit.id,
      sequence: commit.sequence,
      start_ms: commit.startMs,
      end_ms: commit.endMs,
      text: commit.text,
      speaker_label: commit.speakerLabel,
      language_code: commit.languageCode,
      committed_at: commit.committedAt,
      source: 'meetpaper_station',
      provider: commit.provider,
      raw: commit.raw,
    };
  }
}
