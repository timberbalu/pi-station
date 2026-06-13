/**
 * pi-station — shared config loaded from environment
 */

export const config = {
  elevenlabs: {
    apiKey:  process.env['ELEVENLABS_API_KEY']  ?? '',
    wsUrl:   process.env['ELEVENLABS_WS_URL']   ?? 'wss://api.elevenlabs.io/v1/speech-to-text/stream',
  },
  vi: {
    ingestUrl:    process.env['VI_INGEST_URL']    ?? '',
    sessionToken: process.env['VI_SESSION_TOKEN'] ?? '',
  },
  control: {
    port: parseInt(process.env['CONTROL_PORT'] ?? '3456', 10),
    host: process.env['CONTROL_HOST'] ?? '0.0.0.0',
  },
  buffer: {
    dir:        process.env['BUFFER_DIR']  ?? './buffer',
    sqlitePath: process.env['SQLITE_PATH'] ?? './queue.db',
  },
} as const;

export type Config = typeof config;
