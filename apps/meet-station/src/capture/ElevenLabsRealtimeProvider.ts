import WebSocket from 'ws';

import type { PlatformConfig } from '@pi-station/core';
import type { AudioChunk, TranscriptCommit, TranscriptPartial } from '../types.js';
import type { TranscriptProvider } from './TranscriptProvider.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class ElevenLabsRealtimeProvider implements TranscriptProvider {
  readonly name = 'elevenlabs';
  private ws: WebSocket | null = null;
  private connected = false;
  private desiredConnection = false;
  private reconnectDelayMs = 2000;
  private partialListeners: Array<(partial: TranscriptPartial) => void> = [];
  private commitListeners: Array<(commit: Omit<TranscriptCommit, 'id' | 'sessionId'>) => void> = [];
  private connectionListeners: Array<(connected: boolean) => void> = [];

  constructor(private readonly config: PlatformConfig) {}

  async connect(): Promise<void> {
    if (this.connected || this.ws) {
      return;
    }

    this.desiredConnection = true;
    await this.openSocket();
  }

  async disconnect(): Promise<void> {
    this.desiredConnection = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.updateConnection(false);
  }

  async sendAudio(chunk: AudioChunk): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk.pcm);
    }
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

  private async openSocket(): Promise<void> {
    this.ws = new WebSocket(this.config.stt.wsUrl, {
      headers: {
        'xi-api-key': this.config.stt.apiKey,
      },
    });

    this.ws.on('open', () => {
      this.reconnectDelayMs = 2000;
      this.updateConnection(true);
      this.ws?.send(JSON.stringify({
        model_id: this.config.stt.modelId,
        sample_rate: this.config.audio.sampleRate,
        encoding: 'pcm_s16le',
        language: this.config.stt.languageCode,
        diarize: true,
      }));
    });

    this.ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString()) as unknown;
        if (!isRecord(parsed)) {
          return;
        }

        const isFinal = parsed['is_final'] === true || parsed['type'] === 'final_transcript';
        const text = typeof parsed['text'] === 'string'
          ? parsed['text']
          : typeof parsed['transcript'] === 'string'
            ? parsed['transcript']
            : '';

        if (!text) {
          return;
        }

        const speakerLabel = typeof parsed['speaker_id'] === 'string'
          ? parsed['speaker_id']
          : typeof parsed['speaker'] === 'string'
            ? parsed['speaker']
            : null;

        if (isFinal) {
          this.commitListeners.forEach((listener) => listener({
            sequence: Number(parsed['sequence'] ?? 0),
            provider: this.name,
            startMs: Number(parsed['start_ms'] ?? 0),
            endMs: Number(parsed['end_ms'] ?? 0),
            text,
            speakerLabel,
            languageCode: this.config.stt.languageCode,
            confidence: Number(parsed['confidence'] ?? 1),
            raw: parsed,
            committedAt: new Date().toISOString(),
          }));
        } else {
          this.partialListeners.forEach((listener) => listener({
            text,
            speakerLabel,
            receivedAt: new Date().toISOString(),
          }));
        }
      } catch {
        return;
      }
    });

    this.ws.on('close', () => {
      this.ws = null;
      this.updateConnection(false);
      if (this.desiredConnection) {
        setTimeout(() => {
          void this.openSocket();
        }, this.reconnectDelayMs);
        this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30000);
      }
    });

    this.ws.on('error', () => {
      this.updateConnection(false);
    });
  }

  private updateConnection(connected: boolean): void {
    this.connected = connected;
    this.connectionListeners.forEach((listener) => listener(connected));
  }
}
