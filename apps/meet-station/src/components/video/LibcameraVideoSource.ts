import { spawn } from 'node:child_process';
import { existsSync, statSync, watch } from 'node:fs';
import { join } from 'node:path';

import type { Logger } from 'pino';

import type { VideoChunk, VideoSource } from './VideoSource.js';

/**
 * LibcameraVideoSource — spawns rpicam-vid to capture rolling MP4 chunks.
 * Detects new chunk files via fs.watch on the video directory.
 * Used when VIDEO_SOURCE=libcamera on the Pi.
 *
 * rpicam-vid --segment rotates to a new file every N ms, incrementing a
 * printf-style counter in the filename. We watch for new files and emit
 * a VideoChunk event when each file appears and becomes non-empty.
 */
export class LibcameraVideoSource implements VideoSource {
  readonly name = 'libcamera';

  private running = false;
  private chunkIndex = 0;
  private sessionStartMs = 0;
  private proc: ReturnType<typeof spawn> | null = null;
  private watcher: ReturnType<typeof watch> | null = null;
  private knownFiles = new Set<string>();
  private onChunkFn: ((chunk: VideoChunk) => void) | null = null;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly fps: number,
    private readonly bitrate: number,
    private readonly chunkSeconds: number,
    private readonly log: Logger,
  ) {}

  async start(sessionDir: string, onChunk: (chunk: VideoChunk) => void): Promise<void> {
    this.running = true;
    this.chunkIndex = 0;
    this.sessionStartMs = Date.now();
    this.onChunkFn = onChunk;

    const videoDir = join(sessionDir, 'video');
    const outputPattern = join(videoDir, 'chunk-%04d.mp4');

    const args = [
      '--width', String(this.width),
      '--height', String(this.height),
      '--framerate', String(this.fps),
      '--bitrate', String(this.bitrate),
      '--codec', 'h264',
      '--segment', String(this.chunkSeconds * 1000),
      '--output', outputPattern,
      '--nopreview',
      '-t', '0',
    ];

    this.log.info({ args }, '[video/libcamera] spawning rpicam-vid');

    this.proc = spawn('rpicam-vid', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    this.proc.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        this.log.debug({ line }, '[video/libcamera] stderr');
      }
    });

    this.proc.on('error', (err) => {
      this.log.error({ err }, '[video/libcamera] rpicam-vid spawn error — falling back to no video');
      this.running = false;
    });

    this.proc.on('exit', (code) => {
      if (this.running) {
        this.log.warn({ code }, '[video/libcamera] rpicam-vid exited unexpectedly');
        this.running = false;
      }
    });

    // Watch for new chunk files
    this.watcher = watch(videoDir, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.mp4')) {
        return;
      }
      const filePath = join(videoDir, filename);
      if (!this.knownFiles.has(filePath) && existsSync(filePath)) {
        this.knownFiles.add(filePath);
        // Small delay to allow the file to be fully written before we stat it
        setTimeout(() => this.handleNewChunk(filePath), 500);
      }
    });

    this.watcher.on('error', (err) => {
      this.log.warn({ err }, '[video/libcamera] watcher error');
    });
  }

  private handleNewChunk(filePath: string): void {
    if (!this.running || !this.onChunkFn) {
      return;
    }

    let sizeBytes = 0;
    try {
      sizeBytes = statSync(filePath).size;
    } catch {
      this.log.warn({ filePath }, '[video/libcamera] could not stat chunk file');
    }

    this.chunkIndex += 1;
    const startMs = this.sessionStartMs + (this.chunkIndex - 1) * this.chunkSeconds * 1000;

    const chunk: VideoChunk = {
      path: filePath,
      chunkIndex: this.chunkIndex,
      startMs,
      durationMs: this.chunkSeconds * 1000,
      sizeBytes,
    };

    this.log.info({ chunkIndex: this.chunkIndex, path: filePath, sizeBytes }, '[video/libcamera] new chunk');
    this.onChunkFn(chunk);
  }

  async stop(): Promise<void> {
    this.running = false;

    this.watcher?.close();
    this.watcher = null;

    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}
