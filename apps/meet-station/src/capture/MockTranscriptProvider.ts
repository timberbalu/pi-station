import { readFileSync } from 'node:fs';

import type { PlatformConfig } from '@pi-station/core';
import type { TranscriptCommit, TranscriptPartial } from '../types.js';
import type { SimulatableTranscriptProvider } from './TranscriptProvider.js';

export class MockTranscriptProvider implements SimulatableTranscriptProvider {
  readonly name = 'mock';
  private partialListeners: Array<(partial: TranscriptPartial) => void> = [];
  private commitListeners: Array<(commit: Omit<TranscriptCommit, 'id' | 'sessionId'>) => void> = [];
  private connectionListeners: Array<(connected: boolean) => void> = [];
  private lines: string[];
  private connected = false;
  private lineIndex = 0;
  private sequence = 0;
  private clockMs = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(_config: PlatformConfig, fixturePath: string) {
    this.lines = readFileSync(fixturePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.connected = true;
    this.connectionListeners.forEach((listener) => listener(true));
    this.scheduleNext();
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    this.connected = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.connectionListeners.forEach((listener) => listener(false));
  }

  async sendAudio(): Promise<void> {
    return Promise.resolve();
  }

  onPartial(cb: (partial: TranscriptPartial) => void): void {
    this.partialListeners.push(cb);
  }

  onCommit(cb: (commit: Omit<TranscriptCommit, 'id' | 'sessionId'>) => void): void {
    this.commitListeners.push(cb);
  }

  onConnectionChange(cb: (connected: boolean) => void): void {
    this.connectionListeners.push(cb);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async setSimulatedConnection(connected: boolean): Promise<void> {
    if (connected) {
      await this.connect();
    } else {
      await this.disconnect();
    }
  }

  private scheduleNext(): void {
    if (!this.connected) {
      return;
    }

    const line = this.lines[this.lineIndex % this.lines.length] ?? 'Speaker: Placeholder transcript';
    const separatorIndex = line.indexOf(':');
    const speakerLabel = separatorIndex >= 0 ? line.slice(0, separatorIndex).trim() : 'Speaker';
    const text = separatorIndex >= 0 ? line.slice(separatorIndex + 1).trim() : line;
    const receivedAt = new Date().toISOString();

    this.partialListeners.forEach((listener) => listener({
      text,
      speakerLabel,
      receivedAt,
    }));

    this.timer = setTimeout(() => {
      if (!this.connected) {
        return;
      }

      this.sequence += 1;
      const startMs = this.clockMs;
      const durationMs = 3000 + ((this.sequence % 2) * 400);
      const endMs = startMs + durationMs;
      this.clockMs = endMs;
      this.lineIndex += 1;

      this.commitListeners.forEach((listener) => listener({
        sequence: this.sequence,
        provider: this.name,
        startMs,
        endMs,
        text,
        speakerLabel,
        languageCode: 'en',
        confidence: 0.99,
        raw: { fixture: true, line: this.lineIndex },
        committedAt: new Date().toISOString(),
      }));

      this.scheduleNext();
    }, 2200);
  }
}
