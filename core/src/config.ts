import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

import type { PlatformConfig as SharedPlatformConfig } from '@pi-station/shared';

loadEnv();

const envSchema = z.object({
  APP_ID: z.string().min(1).default('meet-station'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3456),
  HOST: z.string().min(1).default('0.0.0.0'),
  STATION_ID: z.string().min(1).default('MPS-001'),
  STATION_NAME: z.string().min(1).default('MeetPaper Station 001'),
  DATA_DIR: z.string().min(1).default('./data'),
  SQLITE_PATH: z.string().min(1).default('./data/station.sqlite'),
  AUDIO_DIR: z.string().min(1).default('./data/audio'),
  AUDIO_SOURCE: z.enum(['mock', 'arecord', 'file']).default('mock'),
  AUDIO_DEVICE: z.string().min(1).default('plughw:1,0'),
  AUDIO_SAMPLE_RATE: z.coerce.number().int().positive().default(16000),
  AUDIO_CHANNELS: z.coerce.number().int().positive().default(1),
  AUDIO_CHUNK_SECONDS: z.coerce.number().int().positive().default(30),
  AUDIO_FILE_PATH: z.string().default(''),
  STT_PROVIDER: z.enum(['mock', 'elevenlabs', 'faster-whisper']).default('mock'),
  FASTER_WHISPER_MODEL: z.string().min(1).default('base.en'),
  FASTER_WHISPER_SCRIPT: z.string().default('scripts/transcribe.py'),
  ELEVENLABS_API_KEY: z.string().default(''),
  ELEVENLABS_MODEL_ID: z.string().min(1).default('scribe_v2_realtime'),
  ELEVENLABS_LANGUAGE_CODE: z.string().min(1).default('en'),
  ELEVENLABS_INCLUDE_TIMESTAMPS: z.coerce.boolean().default(true),
  VOICE_INGEST_URL: z.string().url().default('http://localhost:3456/mock/ingest'),
  VOICE_INGEST_TOKEN: z.string().default('dev-token'),
  VOICE_INGEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  PAIRING_MODE: z.enum(['local', 'remote']).default('local'),
  STATION_PAIRING_URL: z.string().default(''),
  STATION_PAIRING_TOKEN: z.string().default(''),
  RELAY_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  RELAY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(50),
  RELAY_INITIAL_BACKOFF_MS: z.coerce.number().int().positive().default(1000),
  RELAY_MAX_BACKOFF_MS: z.coerce.number().int().positive().default(30000),
  ENABLE_MOCK_INGEST: z.coerce.boolean().default(true),
  MOCK_INGEST_AVAILABLE: z.coerce.boolean().default(true),
  STATION_SYNC_URL: z.string().url().default('http://localhost:3456/mock/station'),
  SYNC_HEALTH_URL: z.string().url().default('http://localhost:3456/health'),
  SYNC_PART_SIZE: z.coerce.number().int().positive().default(5242880),
  CONNECTIVITY_PROBE_INTERVAL_MS: z.coerce.number().int().positive().default(10000),
  AWS_REGION: z.string().min(1).default('eu-west-2'),
  ENABLED_COMPONENTS: z.string().min(1).default('voice'),
  ENABLE_GPIO: z.coerce.boolean().default(false),
  GPIO_CHIP: z.string().min(1).default('gpiochip0'),
  GPIO_RED_PIN: z.coerce.number().int().nonnegative().default(17),
  GPIO_TEAL_PIN: z.coerce.number().int().nonnegative().default(27),
  GPIO_AMBER_PIN: z.coerce.number().int().nonnegative().default(22),
  GPIO_WHITE_PIN: z.coerce.number().int().nonnegative().default(24),
  GPIO_BUTTON_PIN: z.coerce.number().int().nonnegative().default(23),
});

export function loadConfig(source: NodeJS.ProcessEnv = process.env): SharedPlatformConfig {
  const env = envSchema.parse(source);

  return Object.freeze({
    app: Object.freeze({
      id: env.APP_ID,
      env: env.NODE_ENV,
      version: '0.1.0',
      stationId: env.STATION_ID,
      stationName: env.STATION_NAME,
      dataDir: env.DATA_DIR,
    }),
    server: Object.freeze({
      host: env.HOST,
      port: env.PORT,
    }),
    database: Object.freeze({
      sqlitePath: env.SQLITE_PATH,
    }),
    audio: Object.freeze({
      source: env.AUDIO_SOURCE,
      device: env.AUDIO_DEVICE,
      sampleRate: env.AUDIO_SAMPLE_RATE,
      channels: env.AUDIO_CHANNELS,
      chunkSeconds: env.AUDIO_CHUNK_SECONDS,
      filePath: env.AUDIO_FILE_PATH,
      audioDir: env.AUDIO_DIR,
    }),
    stt: Object.freeze({
      provider: env.STT_PROVIDER,
      apiKey: env.ELEVENLABS_API_KEY,
      modelId: env.ELEVENLABS_MODEL_ID,
      languageCode: env.ELEVENLABS_LANGUAGE_CODE,
      includeTimestamps: env.ELEVENLABS_INCLUDE_TIMESTAMPS,
      wsUrl: 'wss://api.elevenlabs.io/v1/speech-to-text/stream',
      fasterWhisperModel: env.FASTER_WHISPER_MODEL,
      fasterWhisperScript: env.FASTER_WHISPER_SCRIPT,
    }),
    relay: Object.freeze({
      ingestUrl: env.VOICE_INGEST_URL,
      ingestToken: env.VOICE_INGEST_TOKEN,
      timeoutMs: env.VOICE_INGEST_TIMEOUT_MS,
      flushIntervalMs: env.RELAY_FLUSH_INTERVAL_MS,
      maxAttempts: env.RELAY_MAX_ATTEMPTS,
      initialBackoffMs: env.RELAY_INITIAL_BACKOFF_MS,
      maxBackoffMs: env.RELAY_MAX_BACKOFF_MS,
      enableMockIngest: env.ENABLE_MOCK_INGEST,
      mockIngestAvailable: env.MOCK_INGEST_AVAILABLE,
    }),
    pairing: Object.freeze({
      mode: env.PAIRING_MODE,
      url: env.STATION_PAIRING_URL,
      token: env.STATION_PAIRING_TOKEN,
    }),
    sync: Object.freeze({
      url: env.STATION_SYNC_URL,
      healthUrl: env.SYNC_HEALTH_URL,
      partSize: env.SYNC_PART_SIZE,
      probeIntervalMs: env.CONNECTIVITY_PROBE_INTERVAL_MS,
      awsRegion: env.AWS_REGION,
    }),
    hardware: Object.freeze({
      enabledComponents: env.ENABLED_COMPONENTS,
      enableGpio: env.ENABLE_GPIO,
      chip: env.GPIO_CHIP,
      redPin: env.GPIO_RED_PIN,
      tealPin: env.GPIO_TEAL_PIN,
      amberPin: env.GPIO_AMBER_PIN,
      whitePin: env.GPIO_WHITE_PIN,
      buttonPin: env.GPIO_BUTTON_PIN,
    }),
  });
}

export type PlatformConfig = ReturnType<typeof loadConfig>;
export const config = loadConfig();
