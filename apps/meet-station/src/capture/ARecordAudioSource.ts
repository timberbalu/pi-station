import { spawn, type ChildProcess } from 'node:child_process';

import type { PlatformConfig } from '@pi-station/core';
import type { AudioChunk } from '../types.js';
import type { AudioSource } from './AudioSource.js';

export class ARecordAudioSource implements AudioSource {
  readonly name = 'arecord';
  private child: ChildProcess | null = null;
  private listeners: Array<(error: Error) => void> = [];

  constructor(private readonly config: PlatformConfig) {}

  async start(onChunk: (chunk: AudioChunk) => void): Promise<void> {
    if (this.child) {
      return;
    }

    const args = [
      '-D',
      this.config.audio.device,
      '-f',
      'S16_LE',
      '-r',
      String(this.config.audio.sampleRate),
      '-c',
      String(this.config.audio.channels),
      '-t',
      'raw',
      '-',
    ];

    const child = spawn('arecord', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;

    child.stdout.on('data', (pcm: Buffer) => {
      const bytesPerSecond = this.config.audio.sampleRate * this.config.audio.channels * 2;
      const durationMs = Math.max(1, Math.round((pcm.length / bytesPerSecond) * 1000));

      onChunk({
        pcm,
        timestamp: new Date(),
        durationMs,
      });
    });

    child.on('error', (error) => {
      this.listeners.forEach((listener) => listener(error));
    });

    child.on('close', (code) => {
      if (code !== 0 && code !== null) {
        const error = new Error(`arecord exited with code ${code}`);
        this.listeners.forEach((listener) => listener(error));
      }
      this.child = null;
    });
  }

  async stop(): Promise<void> {
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
  }

  isRunning(): boolean {
    return this.child !== null;
  }

  onError(cb: (error: Error) => void): void {
    this.listeners.push(cb);
  }
}
