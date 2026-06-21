import type { AudioChunk } from '../types.js';

export interface AudioSource {
  readonly name: string;
  start(onChunk: (chunk: AudioChunk) => void): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  onError(cb: (error: Error) => void): void;
}
