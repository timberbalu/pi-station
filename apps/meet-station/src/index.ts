import { fileURLToPath } from 'node:url';

import { config } from '@pi-station/core';
import {
  ConsoleHardwareController,
  createRepositories,
  GpioHardwareController,
  HealthLog,
  logger,
  openDatabase,
  StationEventBus,
  StationStateMachine,
} from '@pi-station/core';
import { buildServer } from './control/server.js';
import { ReportGenerator } from './report/ReportGenerator.js';
import { MeetStationApp } from './MeetStationApp.js';
import { CaptureService } from './capture/CaptureService.js';
import { ARecordAudioSource } from './capture/ARecordAudioSource.js';
import { ElevenLabsRealtimeProvider } from './capture/ElevenLabsRealtimeProvider.js';
import { FileReplayAudioSource } from './capture/FileReplayAudioSource.js';
import { MockAudioSource } from './capture/MockAudioSource.js';
import { MockTranscriptProvider } from './capture/MockTranscriptProvider.js';
import { WavChunkWriter } from './capture/WavChunkWriter.js';
import { IngestClient } from './relay/IngestClient.js';
import { RelayService } from './relay/RelayService.js';
import type { AudioSource } from './capture/AudioSource.js';
import type { TranscriptProvider } from './capture/TranscriptProvider.js';

function createAudioSource(): AudioSource {
  if (config.audio.source === 'arecord') {
    return new ARecordAudioSource(config);
  }

  if (config.audio.source === 'file') {
    return new FileReplayAudioSource(config);
  }

  return new MockAudioSource(config);
}

function createTranscriptProvider(): TranscriptProvider {
  if (config.stt.provider === 'elevenlabs') {
    return new ElevenLabsRealtimeProvider(config);
  }

  return new MockTranscriptProvider(
    config,
    fileURLToPath(new URL('../fixtures/mock-panel-transcript.txt', import.meta.url)),
  );
}

const db = openDatabase(config);
const repositories = createRepositories(db);
const bus = new StationEventBus();
const stateMachine = new StationStateMachine(bus);
const hardware = config.hardware.enableGpio
  ? new GpioHardwareController(config.hardware.chip, logger)
  : new ConsoleHardwareController(logger);
const wavWriter = new WavChunkWriter(config, repositories.audioChunks, logger);
const capture = new CaptureService(
  config,
  createAudioSource(),
  createTranscriptProvider(),
  wavWriter,
  bus,
  logger,
);
const relay = new RelayService(
  config,
  repositories,
  new IngestClient(config, logger),
  bus,
  {
    onQueueBacklog: () => undefined,
    onQueueDrained: () => undefined,
  },
  logger,
);
const reportGenerator = new ReportGenerator(config, repositories);
const app = new MeetStationApp(
  config,
  db,
  repositories,
  bus,
  stateMachine,
  hardware,
  capture,
  relay,
  reportGenerator,
  logger,
);
const healthLog = new HealthLog(bus, repositories.sessionEvents);

healthLog.start();
await app.initialize();

const server = await buildServer({ app });
await server.listen({ host: config.server.host, port: config.server.port });
logger.info({ url: `http://${config.server.host}:${config.server.port}` }, 'MeetPaper Station ready');

const shutdown = async (): Promise<void> => {
  logger.info('Shutting down MeetPaper Station');
  await server.close();
  await app.shutdown();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
