import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildServer } from '../src/control/server.js';
import {
  ConnectivityProbe,
  ConsoleHardwareController,
  createRepositories,
  HealthLog,
  HttpStationSyncClient,
  loadConfig,
  logger,
  MediaUploader,
  openDatabase,
  StationEventBus,
  StationStateMachine,
  SyncService,
} from '@pi-station/core';
import { ReportGenerator } from '../src/report/ReportGenerator.js';
import { MeetStationApp } from '../src/MeetStationApp.js';
import { CaptureService } from '../src/capture/CaptureService.js';
import { MockAudioSource } from '../src/capture/MockAudioSource.js';
import { MockTranscriptProvider } from '../src/capture/MockTranscriptProvider.js';
import { WavChunkWriter } from '../src/capture/WavChunkWriter.js';
import { IngestClient } from '../src/relay/IngestClient.js';
import { RelayService } from '../src/relay/RelayService.js';
import { VoiceComponent } from '../src/components/voice/VoiceComponent.js';

describe('sync end to end (mock S3)', () => {
  it('syncs manifest, segments and audio to S3 on stop', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-e2e-'));
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      DATA_DIR: root,
      SQLITE_PATH: join(root, 'station.sqlite'),
      AUDIO_DIR: join(root, 'audio'),
      AUDIO_CHUNK_SECONDS: '1',
      STATION_SYNC_URL: 'http://localhost:3456/mock/station',
      SYNC_HEALTH_URL: 'http://localhost:3456/health',
    });
    const db = openDatabase(config);
    const repositories = createRepositories(db);
    const bus = new StationEventBus();
    const stateMachine = new StationStateMachine(bus);
    const capture = new CaptureService(
      config,
      new MockAudioSource(config),
      new MockTranscriptProvider(
        config,
        fileURLToPath(new URL('../fixtures/mock-panel-transcript.txt', import.meta.url)),
      ),
      new WavChunkWriter(config, repositories.audioChunks, logger),
      bus,
      logger,
    );
    const relay = new RelayService(
      config,
      repositories,
      new IngestClient(config, logger),
      bus,
      { onQueueBacklog: () => undefined, onQueueDrained: () => undefined },
      logger,
    );
    const voice = new VoiceComponent(capture, relay);
    const syncClient = new HttpStationSyncClient(config.sync.url, config.relay.timeoutMs);
    const uploader = new MediaUploader({
      client: syncClient,
      mediaTransfer: repositories.mediaTransfer,
      partSize: config.sync.partSize,
      timeoutMs: config.relay.timeoutMs,
      token: config.relay.ingestToken,
      logger,
    });
    const syncService = new SyncService({
      config,
      repositories,
      bus,
      logger,
      client: syncClient,
      uploader,
      components: ['voice'],
      flushSegments: async () => { await voice.flush(); },
    });
    const probe = new ConnectivityProbe({
      healthUrl: config.sync.healthUrl,
      intervalMs: 10000,
      timeoutMs: 1000,
      logger,
    });
    const app = new MeetStationApp(
      config,
      db,
      repositories,
      bus,
      stateMachine,
      new ConsoleHardwareController(logger),
      [voice],
      new ReportGenerator(config, repositories),
      logger,
      syncService,
      probe,
    );
    new HealthLog(bus, repositories.sessionEvents).start();
    await app.initialize();

    const server = await buildServer({ app });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const payload = init?.body instanceof Buffer || typeof init?.body === 'string'
        ? init.body
        : undefined;
      const response = await server.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'PUT',
        url: `${url.pathname}${url.search}`,
        headers: init?.headers as Record<string, string> | undefined,
        payload,
      });
      return new Response(response.body, {
        status: response.statusCode,
        headers: response.headers as HeadersInit,
      });
    }) as typeof fetch;

    try {
      await server.inject({ method: 'POST', url: '/pair', payload: { session_code: '482913', title: 'E2E' } });
      await server.inject({ method: 'POST', url: '/start' });
      // Let audio accumulate and at least one 1s chunk roll over.
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await server.inject({ method: 'POST', url: '/stop' });

      const status = (await server.inject({ method: 'GET', url: '/status' })).json();
      expect(status.sync).not.toBeNull();
      expect(status.sync.manifest).toBe('confirmed');
      expect(status.sync.segments.status).toBe('synced');
      expect(status.sync.audio.status).toBe('complete');
      expect(status.sync.sync_complete).toBe(true);
      expect(status.sync.audio.chunks.length).toBeGreaterThan(0);
      expect(status.sync.audio.chunks.every((c: { status: string }) => c.status === 'uploaded')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      await server.close();
      await app.shutdown();
    }
  }, 15000);
});
