import { readFileSync } from 'node:fs';

import type { PlatformConfig } from '@pi-station/core';
import type { AudioChunk } from '../types.js';
import type { AudioSource } from './AudioSource.js';

export class FileReplayAudioSource implements AudioSource {
  readonly name = 'file';
  private timer: NodeJS.Timeout | null = null;
  private listeners: Array<(error: Error) => void> = [];
  private buffer = Buffer.alloc(0);
  private cursor = 0;

  constructor(private readonly config: PlatformConfig) {}

  async start(onChunk: (chunk: AudioChunk) => void): Promise<void> {
    if (this.timer) {
      return;
    }

    if (!this.config.audio.filePath) {
      const error = new Error('AUDIO_FILE_PATH is required when AUDIO_SOURCE=file');
      this.listeners.forEach((listener) => listener(error));
      throw error;
    }

    const source = readFileSync(this.config.audio.filePath);
    this.buffer = this.config.audio.filePath.endsWith('.wav') ? source.subarray(44) : source;
    this.cursor = 0;

    const durationMs = 250;
    const chunkSize = Math.floor(
      this.config.audio.sampleRate * this.config.audio.channels * 2 * (durationMs / 1000),
    );

    this.timer = setInterval(() => {
      if (this.cursor >= this.buffer.length) {
        this.cursor = 0;
      }

      const pcm = this.buffer.subarray(this.cursor, this.cursor + chunkSize);
      this.cursor += chunkSize;

      onChunk({
        pcm,
        timestamp: new Date(),
        durationMs,
      });
    }, durationMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  onError(cb: (error: Error) => void): void {
    this.listeners.push(cb);
  }
}
