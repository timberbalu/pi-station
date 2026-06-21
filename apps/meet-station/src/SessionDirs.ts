import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { PlatformConfig } from '@pi-station/core';

/**
 * Create the full session directory tree atomically.
 * Called by the host before startSession is fanned out to components.
 * Safe to call multiple times (recursive: true is idempotent).
 *
 * Structure:
 *   {videoDir}/{sessionId}/audio/        ← WAV chunks (VoiceComponent / WavChunkWriter)
 *   {videoDir}/{sessionId}/video/        ← MP4 chunks (VideoComponent)
 *   {videoDir}/{sessionId}/transcripts/  ← faster-whisper output
 *   {facesDir}/{sessionId}/faces/        ← AI HAT+ face detection JSON per chunk
 */
export function createSessionDirs(sessionId: string, config: PlatformConfig): void {
  const videoBase = join(config.video.videoDir, sessionId);
  mkdirSync(join(videoBase, 'audio'), { recursive: true });
  mkdirSync(join(videoBase, 'video'), { recursive: true });
  mkdirSync(join(videoBase, 'transcripts'), { recursive: true });
  mkdirSync(join(config.video.facesDir, sessionId, 'faces'), { recursive: true });
  mkdirSync(config.video.reportsDir, { recursive: true });
}
