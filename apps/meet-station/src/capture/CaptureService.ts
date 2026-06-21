import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';

import type { PlatformConfig } from '@pi-station/core';
import { nowIso } from '../types.js';
import type { SessionSummary, TranscriptCommit } from '../types.js';
import { StationEventBus } from '@pi-station/core';
import type { AudioSource } from './AudioSource.js';
import type { SimulatableTranscriptProvider, TranscriptProvider } from './TranscriptProvider.js';
import { WavChunkWriter } from './WavChunkWriter.js';

export class CaptureService {
  private session: SessionSummary | null = null;
  private committedSegments = 0;
  private lastPartialAt: string | null = null;
  private lastCommitAt: string | null = null;
  private currentPartial: string | null = null;
  private lastLevelDb: number | null = null;
  private sttConnected = false;
  private handleCommit?: (commit: TranscriptCommit) => Promise<void>;

  constructor(
    private readonly config: PlatformConfig,
    private readonly audioSource: AudioSource,
    private readonly transcriptProvider: TranscriptProvider,
    private readonly wavWriter: WavChunkWriter,
    private readonly bus: StationEventBus,
    private readonly log: Logger,
  ) {
    this.audioSource.onError((error) => {
      this.log.error({ error }, '[capture] audio source error');
      this.bus.emitSessionEvent({
        sessionId: this.session?.sessionId ?? null,
        type: 'error',
        level: 'error',
        message: error.message,
      });
    });

    this.transcriptProvider.onPartial((partial) => {
      this.lastPartialAt = partial.receivedAt;
      this.currentPartial = partial.text;
      this.bus.emitTranscriptPartial(partial);
    });

    this.transcriptProvider.onCommit((commit) => {
      if (!this.session) {
        return;
      }

      const fullCommit: TranscriptCommit = {
        ...commit,
        id: randomUUID(),
        sessionId: this.session.sessionId,
      };

      this.committedSegments += 1;
      this.lastCommitAt = fullCommit.committedAt;
      this.currentPartial = null;
      this.bus.emitTranscriptCommit(fullCommit);
      this.bus.emitSessionEvent({
        sessionId: this.session.sessionId,
        type: 'segment_committed',
        level: 'info',
        message: `Committed transcript segment ${fullCommit.sequence}`,
        payload: { sequence: fullCommit.sequence },
      });
      void this.handleCommit?.(fullCommit);
    });

    this.transcriptProvider.onConnectionChange((connected) => {
      this.sttConnected = connected;
      this.bus.emitSessionEvent({
        sessionId: this.session?.sessionId ?? null,
        type: connected ? 'stt_connected' : 'stt_disconnected',
        level: connected ? 'info' : 'warn',
        message: connected ? 'STT connected' : 'STT disconnected',
      });
    });
  }

  async prepare(): Promise<void> {
    await this.wavWriter.repairOpenChunks();
  }

  onCommittedSegment(handler: (commit: TranscriptCommit) => Promise<void>): void {
    this.handleCommit = handler;
  }

  async start(session: SessionSummary): Promise<void> {
    this.session = session;
    this.committedSegments = 0;
    this.lastPartialAt = null;
    this.lastCommitAt = null;
    this.currentPartial = null;
    this.wavWriter.startSession(session.sessionId);
    await this.transcriptProvider.connect();
    await this.audioSource.start((chunk) => {
      this.lastLevelDb = chunk.levelDb ?? null;
      if (chunk.levelDb !== undefined) {
        this.bus.emitAudioEnergy({ levelDb: chunk.levelDb, speechActive: chunk.levelDb > -30 });
      }
      this.wavWriter.append(chunk);
      void this.transcriptProvider.sendAudio(chunk);
    });
    this.bus.emitSessionEvent({
      sessionId: session.sessionId,
      type: 'recording_started',
      level: 'info',
      message: 'Recording started',
      payload: { startedAt: session.startedAt },
    });
  }

  async pause(): Promise<void> {
    await this.audioSource.stop();
    await this.transcriptProvider.disconnect();
    this.wavWriter.pause();
  }

  async resume(): Promise<void> {
    if (!this.session) {
      throw new Error('Cannot resume without an active session');
    }

    this.wavWriter.startSession(this.session.sessionId);
    await this.transcriptProvider.connect();
    await this.audioSource.start((chunk) => {
      this.lastLevelDb = chunk.levelDb ?? null;
      if (chunk.levelDb !== undefined) {
        this.bus.emitAudioEnergy({ levelDb: chunk.levelDb, speechActive: chunk.levelDb > -30 });
      }
      this.wavWriter.append(chunk);
      void this.transcriptProvider.sendAudio(chunk);
    });
  }

  async stop(): Promise<void> {
    await this.audioSource.stop();
    await this.transcriptProvider.disconnect();
    this.wavWriter.stop();
  }

  isRecording(): boolean {
    return this.audioSource.isRunning();
  }

  isTranscriptConnected(): boolean {
    return this.sttConnected;
  }

  async setTranscriptConnectionForSimulation(connected: boolean): Promise<void> {
    const provider = this.transcriptProvider as Partial<SimulatableTranscriptProvider>;
    if (typeof provider.setSimulatedConnection === 'function') {
      await provider.setSimulatedConnection(connected);
    }
  }

  getStatus() {
    return {
      recording: this.isRecording(),
      mic: {
        available: this.config.audio.source === 'mock' || this.audioSource.isRunning(),
        source: this.audioSource.name,
        device: this.config.audio.source === 'mock' ? 'mock' : this.config.audio.device,
        sampleRate: this.config.audio.sampleRate,
        channels: this.config.audio.channels,
        levelDb: this.lastLevelDb,
      },
      stt: {
        provider: this.transcriptProvider.name,
        connected: this.sttConnected,
        lastPartialAt: this.lastPartialAt,
        lastCommitAt: this.lastCommitAt,
        committedSegments: this.committedSegments,
        currentPartial: this.currentPartial,
      },
      buffer: this.wavWriter.getMetrics(),
      timestamp: nowIso(),
    };
  }
}
