import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { Logger } from 'pino';

import type { PlatformConfig } from '@pi-station/core';
import type { Repositories } from '@pi-station/core';

export interface CleanupResult {
  sessionId: string;
  audioDeleted: number;
  videoDeleted: number;
  bytesFreed: number;
}

/**
 * SessionCleaner — prunes local media files after a session has been fully
 * synced to S3 (sync_complete = 1). Transcripts, face JSON, reports, and the
 * SQLite database are intentionally kept.
 *
 * Trigger: POST /sessions/:id/cleanup or automatic after sync_complete.
 */
export class SessionCleaner {
  constructor(
    private readonly config: PlatformConfig,
    private readonly repositories: Repositories,
    private readonly log: Logger,
  ) {}

  /**
   * Delete WAV and MP4 files for a session. Only runs if sync_complete = 1.
   * Returns a summary of what was deleted.
   */
  async clean(sessionId: string): Promise<CleanupResult> {
    const syncState = this.repositories.syncState.get(sessionId);

    if (!syncState || syncState.syncComplete !== 1) {
      throw new Error(
        `Session ${sessionId} has not been fully synced (sync_complete != 1). Refusing to clean.`,
      );
    }

    this.log.info({ sessionId }, '[cleaner] cleaning session media files');

    let audioDeleted = 0;
    let videoDeleted = 0;
    let bytesFreed = 0;

    // Delete audio WAVs
    const audioDir = join(this.config.video.videoDir, sessionId, 'audio');
    if (existsSync(audioDir)) {
      const result = this.deleteGlob(audioDir, '.wav');
      audioDeleted = result.count;
      bytesFreed += result.bytes;
    }

    // Delete video MP4s
    const videoDir = join(this.config.video.videoDir, sessionId, 'video');
    if (existsSync(videoDir)) {
      const result = this.deleteGlob(videoDir, '.mp4');
      videoDeleted = result.count;
      bytesFreed += result.bytes;
    }

    this.log.info(
      { sessionId, audioDeleted, videoDeleted, bytesFreed },
      '[cleaner] session media cleaned',
    );

    return { sessionId, audioDeleted, videoDeleted, bytesFreed };
  }

  private deleteGlob(dir: string, ext: string): { count: number; bytes: number } {
    let count = 0;
    let bytes = 0;

    try {
      const files = readdirSync(dir).filter((f) => f.endsWith(ext));
      for (const file of files) {
        const filePath = join(dir, file);
        try {
          bytes += statSync(filePath).size;
          rmSync(filePath);
          count += 1;
        } catch (err) {
          this.log.warn({ err, filePath }, '[cleaner] could not delete file');
        }
      }
    } catch (err) {
      this.log.warn({ err, dir }, '[cleaner] could not read directory');
    }

    return { count, bytes };
  }
}
