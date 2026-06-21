import type { PlatformConfig } from '@pi-station/core';
import type { AudioChunk } from '../types.js';
import type { AudioSource } from './AudioSource.js';

export class MockAudioSource implements AudioSource {
  readonly name = 'mock';
  private timer: NodeJS.Timeout | null = null;
  private listeners: Array<(error: Error) => void> = [];
  private tick = 0;

  constructor(private readonly config: PlatformConfig) {}

  async start(onChunk: (chunk: AudioChunk) => void): Promise<void> {
    if (this.timer) {
      return;
    }

    const durationMs = 250;
    const bytesPerChunk = Math.floor(
      this.config.audio.sampleRate
      * this.config.audio.channels
      * 2
      * (durationMs / 1000),
    );

    this.timer = setInterval(() => {
      this.tick += 1;
      const pcm = Buffer.alloc(bytesPerChunk, this.tick % 255);
      const levelDb = -24 + (Math.sin(this.tick / 4) * 6);
      onChunk({
        pcm,
        timestamp: new Date(),
        durationMs,
        levelDb,
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
