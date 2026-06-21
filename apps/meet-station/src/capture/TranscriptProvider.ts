import type { AudioChunk, TranscriptCommit, TranscriptPartial } from '../types.js';

export interface TranscriptProvider {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendAudio(chunk: AudioChunk): Promise<void>;
  onPartial(cb: (partial: TranscriptPartial) => void): void;
  onCommit(cb: (commit: Omit<TranscriptCommit, 'id' | 'sessionId'>) => void): void;
  onConnectionChange(cb: (connected: boolean) => void): void;
  isConnected(): boolean;
}

export interface SimulatableTranscriptProvider extends TranscriptProvider {
  setSimulatedConnection(connected: boolean): Promise<void>;
}
