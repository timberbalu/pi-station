import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Logger } from 'pino';

import type { PlatformConfig } from '@pi-station/core';
import type { AudioChunksRepository } from '@pi-station/core';
import { nowIso } from '../types.js';
import type { AudioChunk, AudioChunkRecord } from '../types.js';

interface ActiveChunk {
  id: string;
  sessionId: string;
  chunkIndex: number;
  path: string;
  stream: ReturnType<typeof createWriteStream>;
  bytes: number;
  startMs: number;
  endMs: number;
}

function buildHeader(sampleRate: number, channels: number, dataLength: number): Buffer {
  const blockAlign = channels * 2;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

export class WavChunkWriter {
  private activeChunk: ActiveChunk | null = null;
  private sessionId: string | null = null;
  private sessionElapsedMs = 0;
  private chunkDurationMs: number;
  private totalBytes = 0;
  private totalChunks = 0;

  constructor(
    private readonly config: PlatformConfig,
    private readonly repository: AudioChunksRepository,
    private readonly log: Logger,
  ) {
    this.chunkDurationMs = this.config.audio.chunkSeconds * 1000;
  }

  async repairOpenChunks(): Promise<void> {
    const openChunks = this.repository.getOpenChunks();

    for (const chunk of openChunks) {
      if (!existsSync(chunk.path)) {
        continue;
      }

      const stats = statSync(chunk.path);
      const bytes = Math.max(0, stats.size - 44);
      writeFileSync(chunk.path, buildHeader(chunk.sampleRate, chunk.channels, bytes), { flag: 'r+' });
      this.repository.close(
        chunk.id,
        bytes,
        chunk.endMs,
        'repaired',
        nowIso(),
      );
    }
  }

  startSession(sessionId: string): void {
    if (this.sessionId !== sessionId) {
      const existingChunks = this.repository.listBySession(sessionId);
      this.sessionId = sessionId;
      this.sessionElapsedMs = existingChunks.at(-1)?.endMs ?? 0;
      this.totalBytes = existingChunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
      this.totalChunks = existingChunks.length;
    }
    mkdirSync(join(this.config.audio.audioDir, sessionId), { recursive: true });
    if (!this.activeChunk) {
      this.openNextChunk();
    }
  }

  append(chunk: AudioChunk): void {
    if (!this.activeChunk) {
      return;
    }

    this.activeChunk.stream.write(chunk.pcm);
    this.activeChunk.bytes += chunk.pcm.length;
    this.activeChunk.endMs += chunk.durationMs;
    this.totalBytes += chunk.pcm.length;
    this.sessionElapsedMs += chunk.durationMs;

    this.repository.updateProgress(this.activeChunk.id, this.activeChunk.bytes, this.activeChunk.endMs);

    if ((this.activeChunk.endMs - this.activeChunk.startMs) >= this.chunkDurationMs) {
      this.closeActiveChunk('closed');
      this.openNextChunk();
    }
  }

  pause(): void {
    this.closeActiveChunk('closed');
  }

  stop(): void {
    this.closeActiveChunk('closed');
    this.sessionId = null;
  }

  getMetrics() {
    return {
      audioChunks: this.totalChunks,
      secondsSafe: this.totalBytes / (this.config.audio.sampleRate * this.config.audio.channels * 2),
      bytes: this.totalBytes,
      currentChunkPath: this.activeChunk?.path ?? null,
    };
  }

  private openNextChunk(): void {
    if (!this.sessionId) {
      return;
    }

    const chunkIndex = this.totalChunks + 1;
    const filename = `chunk-${String(chunkIndex).padStart(6, '0')}.wav`;
    const path = join(this.config.audio.audioDir, this.sessionId, filename);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buildHeader(this.config.audio.sampleRate, this.config.audio.channels, 0));

    const stream = createWriteStream(path, { flags: 'a' });
    const record: AudioChunkRecord = {
      id: randomUUID(),
      sessionId: this.sessionId,
      chunkIndex,
      path,
      startMs: this.sessionElapsedMs,
      endMs: this.sessionElapsedMs,
      bytes: 0,
      sampleRate: this.config.audio.sampleRate,
      channels: this.config.audio.channels,
      status: 'open',
      createdAt: nowIso(),
      closedAt: null,
    };

    this.repository.open(record);
    this.activeChunk = {
      id: record.id,
      sessionId: this.sessionId,
      chunkIndex,
      path,
      stream,
      bytes: 0,
      startMs: this.sessionElapsedMs,
      endMs: this.sessionElapsedMs,
    };
    this.totalChunks = chunkIndex;
  }

  private closeActiveChunk(status: 'closed' | 'repaired' | 'error'): void {
    if (!this.activeChunk) {
      return;
    }

    const chunk = this.activeChunk;
    chunk.stream.end();
    writeFileSync(chunk.path, buildHeader(this.config.audio.sampleRate, this.config.audio.channels, chunk.bytes), { flag: 'r+' });
    this.repository.close(chunk.id, chunk.bytes, chunk.endMs, status, nowIso());
    this.log.info({ path: chunk.path, bytes: chunk.bytes }, '[capture] wav chunk closed');
    this.activeChunk = null;
  }
}
