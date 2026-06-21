import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { VideoChunk, VideoSource } from './VideoSource.js';

/**
 * MockVideoSource — emits fake chunk events on a timer.
 * Creates tiny placeholder MP4 files. No camera needed.
 * Used when VIDEO_SOURCE=mock (default for dev/test).
 */
export class MockVideoSource implements VideoSource {
  readonly name = 'mock';

  private running = false;
  private chunkIndex = 0;
  private sessionDir = '';
  private startMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onChunk: ((chunk: VideoChunk) => void) | null = null;

  async start(sessionDir: string, onChunk: (chunk: VideoChunk) => void): Promise<void> {
    this.running = true;
    this.sessionDir = sessionDir;
    this.onChunk = onChunk;
    this.chunkIndex = 0;
    this.startMs = Date.now();

    const videoDir = join(sessionDir, 'video');
    mkdirSync(videoDir, { recursive: true });

    // Emit one mock chunk immediately, then on a timer
    this.emitChunk();

    this.timer = setInterval(() => {
      if (this.running) {
        this.emitChunk();
      }
    }, 30000);
  }

  private emitChunk(): void {
    if (!this.running || !this.onChunk) {
      return;
    }

    this.chunkIndex += 1;
    const chunkPath = join(this.sessionDir, 'video', `chunk-${String(this.chunkIndex).padStart(4, '0')}.mp4`);
    const startMs = this.startMs + (this.chunkIndex - 1) * 30000;

    // Create a tiny placeholder file so filesystem checks work
    writeFileSync(chunkPath, Buffer.alloc(0));

    const chunk: VideoChunk = {
      path: chunkPath,
      chunkIndex: this.chunkIndex,
      startMs,
      durationMs: 30000,
      sizeBytes: 0,
    };

    this.onChunk(chunk);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}
