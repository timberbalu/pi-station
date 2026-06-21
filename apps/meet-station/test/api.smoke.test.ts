import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildServer } from '../src/control/server.js';
import {
  ConsoleHardwareController,
  createRepositories,
  HealthLog,
  loadConfig,
  logger,
  openDatabase,
  StationEventBus,
  StationStateMachine,
} from '@pi-station/core';
import { ReportGenerator } from '../src/report/ReportGenerator.js';
import { MeetStationApp } from '../src/MeetStationApp.js';
import { CaptureService } from '../src/capture/CaptureService.js';
import { MockAudioSource } from '../src/capture/MockAudioSource.js';
import { MockTranscriptProvider } from '../src/capture/MockTranscriptProvider.js';
import { WavChunkWriter } from '../src/capture/WavChunkWriter.js';
import { IngestClient } from '../src/relay/IngestClient.js';
import { RelayService } from '../src/relay/RelayService.js';

describe('API smoke', () => {
  it('pairs, starts, marks, simulates network, and reconnects', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-station-'));
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      DATA_DIR: root,
      SQLITE_PATH: join(root, 'station.sqlite'),
      AUDIO_DIR: join(root, 'audio'),
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
      {
        onQueueBacklog: () => undefined,
        onQueueDrained: () => undefined,
      },
      logger,
    );
    const app = new MeetStationApp(
      config,
      db,
      repositories,
      bus,
      stateMachine,
      new ConsoleHardwareController(logger),
      capture,
      relay,
      new ReportGenerator(config, repositories),
      logger,
    );
    new HealthLog(bus, repositories.sessionEvents).start();
    await app.initialize();

    const server = await buildServer({ app });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const response = await server.inject({
        method: init?.method ?? 'GET',
        url: `${url.pathname}${url.search}`,
        headers: init?.headers as Record<string, string> | undefined,
        payload: typeof init?.body === 'string' ? init.body : undefined,
      });

      return new Response(response.body, {
        status: response.statusCode,
        headers: response.headers as HeadersInit,
      });
    }) as typeof fetch;

    try {
      await server.inject({
        method: 'POST',
        url: '/pair',
        payload: { session_code: '482913', title: 'Smoke Test' },
      });
      await server.inject({ method: 'POST', url: '/start' });
      await new Promise((resolve) => setTimeout(resolve, 2500));

      const beforeDown = await server.inject({ method: 'GET', url: '/status' });
      expect(beforeDown.statusCode).toBe(200);

      await server.inject({ method: 'POST', url: '/mark', payload: {} });
      await server.inject({ method: 'POST', url: '/simulate/network/down' });
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const duringDown = await server.inject({ method: 'GET', url: '/status' });
      const downStatus = duringDown.json();
      expect(downStatus.relay.queued_segments).toBeGreaterThan(0);

      await server.inject({ method: 'POST', url: '/simulate/network/up' });
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const afterUp = await server.inject({ method: 'GET', url: '/status' });
      const upStatus = afterUp.json();
      expect(upStatus.relay.queued_segments).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
      await server.close();
      await app.shutdown();
    }
  }, 15000);
});
