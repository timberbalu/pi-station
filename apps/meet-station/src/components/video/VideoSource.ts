export interface VideoChunk {
  path: string;
  chunkIndex: number;
  startMs: number;
  durationMs: number;
  sizeBytes: number;
}

export interface VideoSource {
  readonly name: string;
  start(sessionDir: string, onChunk: (chunk: VideoChunk) => void): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}
