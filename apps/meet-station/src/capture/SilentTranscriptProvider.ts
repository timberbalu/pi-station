import type { AudioChunk, TranscriptCommit, TranscriptPartial } from '../types.js';
import type { TranscriptProvider } from './TranscriptProvider.js';

/**
 * No-op live transcript provider used when STT_PROVIDER=faster-whisper.
 *
 * faster-whisper is a post-session batch provider, so during the session there is
 * no live transcription — audio is buffered to disk and transcribed on stopSession.
 * Using this (rather than the mock provider) keeps the live session free of
 * fabricated segments, so the batch pass is the single source of the transcript.
 */
export class SilentTranscriptProvider implements TranscriptProvider {
  readonly name = 'faster-whisper';

  private connected = false;
  private connectionCb: ((connected: boolean) => void) | null = null;

  async connect(): Promise<void> {
    this.connected = true;
    this.connectionCb?.(true);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.connectionCb?.(false);
  }

  async sendAudio(_chunk: AudioChunk): Promise<void> {
    // Audio is captured to disk only; no live transcription.
  }

  onPartial(_cb: (partial: TranscriptPartial) => void): void {
    // never emits
  }

  onCommit(_cb: (commit: Omit<TranscriptCommit, 'id' | 'sessionId'>) => void): void {
    // never emits — segments come from the post-session batch pass
  }

  onConnectionChange(cb: (connected: boolean) => void): void {
    this.connectionCb = cb;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
