export interface PlatformConfig {
  readonly app: {
    readonly id: string;
    readonly env: 'development' | 'test' | 'production';
    readonly version: string;
    readonly stationId: string;
    readonly stationName: string;
    readonly dataDir: string;
  };
  readonly server: {
    readonly host: string;
    readonly port: number;
  };
  readonly database: {
    readonly sqlitePath: string;
  };
  readonly audio: {
    readonly source: 'mock' | 'arecord' | 'file';
    readonly device: string;
    readonly sampleRate: number;
    readonly channels: number;
    readonly chunkSeconds: number;
    readonly filePath: string;
    readonly audioDir: string;
  };
  readonly stt: {
    readonly provider: 'mock' | 'elevenlabs' | 'faster-whisper';
    readonly apiKey: string;
    readonly modelId: string;
    readonly languageCode: string;
    readonly includeTimestamps: boolean;
    readonly wsUrl: string;
    readonly fasterWhisperModel: string;
    readonly fasterWhisperScript: string;
    readonly fasterWhisperPython: string;
    readonly fasterWhisperVenvDir: string;
    readonly fasterWhisperTimeoutMultiplier: number;
  };
  readonly relay: {
    readonly ingestUrl: string;
    readonly ingestToken: string;
    readonly timeoutMs: number;
    readonly flushIntervalMs: number;
    readonly maxAttempts: number;
    readonly initialBackoffMs: number;
    readonly maxBackoffMs: number;
    readonly enableMockIngest: boolean;
    readonly mockIngestAvailable: boolean;
  };
  readonly pairing: {
    readonly mode: 'local' | 'remote';
    readonly url: string;
    readonly token: string;
  };
  readonly sync: {
    readonly url: string;
    readonly healthUrl: string;
    readonly partSize: number;
    readonly probeIntervalMs: number;
    readonly awsRegion: string;
  };
  readonly hardware: {
    readonly enabledComponents: string;
    readonly enableGpio: boolean;
    readonly chip: string;
    readonly redPin: number;
    readonly tealPin: number;
    readonly amberPin: number;
    readonly whitePin: number;
    readonly buttonPin: number;
  };
  readonly video: {
    readonly videoSource: 'mock' | 'libcamera';
    readonly videoDir: string;
    readonly facesDir: string;
    readonly reportsDir: string;
    readonly videoWidth: number;
    readonly videoHeight: number;
    readonly videoFps: number;
    readonly videoChunkSeconds: number;
    readonly videoBitrate: number;
  };
  readonly faceDetection: {
    readonly provider: 'mock' | 'hailo' | 'opencv';
    readonly hailoPostProcessFile: string;
  };
  readonly panTilt: {
    readonly controller: 'mock' | 'pca9685';
    readonly i2cBus: number;
    readonly i2cAddress: number;
    readonly panChannel: number;
    readonly tiltChannel: number;
    readonly panMin: number;
    readonly panMax: number;
    readonly tiltMin: number;
    readonly tiltMax: number;
    readonly neutralPan: number;
    readonly neutralTilt: number;
    readonly deadzonePx: number;
    readonly smoothing: number;
  };
}
