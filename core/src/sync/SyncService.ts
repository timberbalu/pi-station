import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';

import type { PlatformConfig } from '../config.js';
import type { Repositories } from '../db/repositories.js';
import { StationEventBus } from '../state/StationEventBus.js';
import {
  nowIso,
  type MediaChunkStatus,
  type MediaTransferRecord,
  type SessionRecord,
  type SyncStatusSummary,
} from '../types.js';
import { MediaUploader } from './MediaUploader.js';
import type { StationSyncClient } from './StationSyncClient.js';

export interface SyncServiceDeps {
  config: PlatformConfig;
  repositories: Repositories;
  bus: StationEventBus;
  logger: Logger;
  client: StationSyncClient;
  uploader: MediaUploader;
  /** Enabled component ids, included in the manifest. */
  components: string[];
  /** Drains the transcript relay queue (phase 2). Provided by the host. */
  flushSegments?: () => Promise<void>;
}

/**
 * Host-level four-phase sync coordinator.
 *
 *   Phase 1 — session manifest      (tiny JSON to apm; gates everything else)
 *   Phase 2 — transcript segments   (existing relay queue drains to depth 0)
 *   Phase 3 — media files to S3      (presign → PUT parts → confirm; resumable)
 *   Phase 4 — sync complete          (tiny JSON; sets sync_complete = 1)
 *
 * Each phase is gated on the previous. A failed phase stops the cycle; the next
 * cycle resumes from the failed phase. All media uploads use presigned URLs, so
 * the Pi never holds AWS credentials.
 */
export class SyncService {
  constructor(private readonly deps: SyncServiceDeps) {}

  /** Runs phases in order; stops at the first phase that is incomplete. */
  async runSyncCycle(sessionId: string): Promise<void> {
    const session = this.deps.repositories.sessions.getById(sessionId);
    if (!session) {
      return;
    }

    this.deps.repositories.syncState.ensure(sessionId, nowIso());

    try {
      if (!(await this.phase1Manifest(session))) {
        return;
      }
      if (!(await this.phase2Segments(session))) {
        return;
      }
      if (!(await this.phase3Media(session))) {
        return;
      }
      await this.phase4Complete(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'sync cycle failure';
      this.deps.repositories.syncState.setError(sessionId, message, nowIso());
      this.deps.logger.warn({ sessionId, error: message }, '[sync] cycle failed');
    }
  }

  /** Best-effort synchronous sync at stop, before report generation. */
  async syncOnStop(sessionId: string): Promise<void> {
    try {
      await this.runSyncCycle(sessionId);
    } catch (error) {
      this.deps.logger.warn({ sessionId, error }, '[sync] syncOnStop failed (non-fatal)');
    }
  }

  getSyncStatus(sessionId: string | null): SyncStatusSummary | null {
    if (!sessionId) {
      return null;
    }
    const state = this.deps.repositories.syncState.get(sessionId);
    if (!state) {
      return null;
    }

    const totalSegments = this.deps.repositories.transcriptSegments.listBySession(sessionId).length;
    const queued = this.deps.repositories.relayQueue.countBySession(sessionId, 'pending')
      + this.deps.repositories.relayQueue.countBySession(sessionId, 'sending');

    return {
      session_id: sessionId,
      manifest: state.manifestStatus,
      segments: {
        status: state.segmentsStatus,
        delivered: Math.max(0, totalSegments - queued),
        total: totalSegments,
      },
      audio: {
        status: state.audioStatus,
        chunks: this.mediaChunkStatuses(sessionId, 'audio'),
      },
      video: {
        status: state.videoStatus,
        chunks: this.mediaChunkStatuses(sessionId, 'video'),
      },
      sync_complete: state.syncComplete === 1,
      last_error: state.lastError,
    };
  }

  private mediaChunkStatuses(sessionId: string, mediaType: 'audio' | 'video'): MediaChunkStatus[] {
    return this.deps.repositories.mediaTransfer.listBySession(sessionId, mediaType).map((record) => {
      const partsDone = parsePartCount(record.partsJson);
      const partsTotal = this.deps.uploader.totalParts(record.fileSize);
      return {
        chunk_index: record.chunkIndex,
        s3_key: record.s3Key,
        status: record.status,
        parts_done: partsDone,
        parts_total: partsTotal,
      };
    });
  }

  private async phase1Manifest(session: SessionRecord): Promise<boolean> {
    const state = this.deps.repositories.syncState.get(session.id);
    if (state?.manifestStatus === 'confirmed') {
      return true;
    }

    const result = await this.deps.client.manifest({
      session_id: session.id,
      session_code: session.sessionCode,
      title: session.title,
      station_id: this.deps.config.app.stationId,
      started_at: session.startedAt,
      stopped_at: session.stoppedAt,
      components: this.deps.components,
    }, session.stationToken);

    if (!result.accepted) {
      this.deps.repositories.syncState.setManifest(session.id, 'failed', nowIso());
      return false;
    }

    this.deps.repositories.syncState.setManifest(session.id, 'confirmed', nowIso());
    this.emit(session.id, 'sync_manifest_confirmed', 'Session manifest confirmed');
    return true;
  }

  private async phase2Segments(session: SessionRecord): Promise<boolean> {
    this.deps.repositories.syncState.setSegments(session.id, 'in_progress', nowIso());

    if (this.deps.flushSegments) {
      await this.deps.flushSegments();
    }

    const queued = this.deps.repositories.relayQueue.countBySession(session.id, 'pending')
      + this.deps.repositories.relayQueue.countBySession(session.id, 'sending');

    if (queued > 0) {
      return false;
    }

    this.deps.repositories.syncState.setSegments(session.id, 'synced', nowIso());
    this.emit(session.id, 'sync_segments_synced', 'Transcript segments delivered');
    return true;
  }

  private async phase3Media(session: SessionRecord): Promise<boolean> {
    this.enqueueAudioChunks(session.id);
    // Video chunks (J6) will be enqueued here once VideoComponent writes them.

    const audioComplete = await this.uploadMediaType(session.id, 'audio');
    const videoComplete = await this.uploadMediaType(session.id, 'video');

    return audioComplete && videoComplete;
  }

  private enqueueAudioChunks(sessionId: string): void {
    const chunks = this.deps.repositories.audioChunks.listBySession(sessionId)
      .filter((chunk) => chunk.status === 'closed' || chunk.status === 'repaired');

    for (const chunk of chunks) {
      const s3Key = `vi-media/sessions/${sessionId}/audio/chunk-${String(chunk.chunkIndex).padStart(4, '0')}.wav`;
      const record: MediaTransferRecord = {
        id: randomUUID(),
        sessionId,
        mediaType: 'audio',
        filePath: chunk.path,
        s3Key,
        chunkIndex: chunk.chunkIndex,
        fileSize: chunk.bytes + 44, // include WAV header
        s3UploadId: null,
        partsJson: '[]',
        status: 'pending',
        attempts: 0,
        lastError: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      this.deps.repositories.mediaTransfer.enqueue(record);
    }
  }

  private async uploadMediaType(sessionId: string, mediaType: 'audio' | 'video'): Promise<boolean> {
    const records = this.deps.repositories.mediaTransfer.listBySession(sessionId, mediaType);

    if (records.length === 0) {
      // Nothing of this type — mark skipped so the phase doesn't block.
      const setter = mediaType === 'audio'
        ? this.deps.repositories.syncState.setAudio.bind(this.deps.repositories.syncState)
        : this.deps.repositories.syncState.setVideo.bind(this.deps.repositories.syncState);
      setter(sessionId, 'skipped', nowIso());
      return true;
    }

    const setter = mediaType === 'audio'
      ? this.deps.repositories.syncState.setAudio.bind(this.deps.repositories.syncState)
      : this.deps.repositories.syncState.setVideo.bind(this.deps.repositories.syncState);
    setter(sessionId, 'in_progress', nowIso());

    let allOk = true;
    for (const record of records) {
      if (record.status === 'uploaded') {
        continue;
      }
      const outcome = await this.deps.uploader.uploadFile(record);
      if (!outcome.ok) {
        allOk = false;
        break;
      }
    }

    if (allOk) {
      setter(sessionId, 'complete', nowIso());
      this.emit(sessionId, `sync_${mediaType}_complete`, `${mediaType} uploaded to S3`);
    }
    return allOk;
  }

  private async phase4Complete(session: SessionRecord): Promise<boolean> {
    await this.deps.client.syncComplete(session.id, this.deps.components, session.stationToken);
    this.deps.repositories.syncState.markComplete(session.id, nowIso());
    this.emit(session.id, 'sync_complete', 'Sync complete — Pi handoff done');
    return true;
  }

  private emit(sessionId: string, type: string, message: string): void {
    this.deps.bus.emitSessionEvent({ sessionId, type, level: 'info', message });
  }
}

function parsePartCount(json: string): number {
  try {
    const parsed = JSON.parse(json) as unknown[];
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
