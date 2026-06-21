import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  createRepositories,
  loadConfig,
  logger,
  MediaUploader,
  StationEventBus,
  SyncService,
  openDatabase,
} from '@pi-station/core';
import type {
  ConfirmedPart,
  ConfirmResult,
  ManifestResult,
  PresignOptions,
  PresignResult,
  StationSyncClient,
} from '@pi-station/core';

class FakeSyncClient implements StationSyncClient {
  manifestShouldFail = false;
  calls: string[] = [];

  async manifest(): Promise<ManifestResult> {
    this.calls.push('manifest');
    return this.manifestShouldFail
      ? { accepted: false, existing: false }
      : { accepted: true, existing: false };
  }

  async presign(
    _sessionId: string,
    _key: string,
    fileSize: number,
    partSize: number,
    _token: string,
    opts: PresignOptions = {},
  ): Promise<PresignResult> {
    this.calls.push('presign');
    const total = Math.max(1, Math.ceil(fileSize / partSize));
    const from = opts.fromPart ?? 1;
    const parts = [];
    for (let n = from; n <= total; n += 1) {
      parts.push({ partNumber: n, url: `mock://part/${n}` });
    }
    return { uploadId: 'upload-1', parts };
  }

  async confirm(_s: string, key: string, _u: string, _p: ConfirmedPart[]): Promise<ConfirmResult> {
    this.calls.push('confirm');
    return { confirmed: true, s3Key: key };
  }

  async syncComplete(): Promise<boolean> {
    this.calls.push('syncComplete');
    return true;
  }
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'pi-phases-'));
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
  const now = new Date().toISOString();

  repositories.sessions.create({
    id: 'session-1',
    sessionCode: '482913',
    title: 'Phases Test',
    state: 'REPORT_READY',
    stationToken: 'tok',
    ingestUrl: 'http://localhost/ingest',
    startedAt: now,
    stoppedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  // One closed audio chunk on disk for the media phase.
  const chunkPath = join(root, 'chunk-0001.wav');
  writeFileSync(chunkPath, Buffer.alloc(100, 7));
  repositories.audioChunks.open({
    id: 'chunk-1',
    sessionId: 'session-1',
    chunkIndex: 1,
    path: chunkPath,
    startMs: 0,
    endMs: 30000,
    bytes: 56,
    sampleRate: 16000,
    channels: 1,
    status: 'closed',
    createdAt: now,
    closedAt: now,
  });

  const client = new FakeSyncClient();
  const uploader = new MediaUploader({
    client,
    mediaTransfer: repositories.mediaTransfer,
    partSize: config.sync.partSize,
    timeoutMs: 1000,
    token: 'tok',
    logger,
    httpPut: async (url) => ({ ok: true, status: 200, etag: `"etag-${url.split('/').pop()}"` }),
  });
  const service = new SyncService({
    config,
    repositories,
    bus,
    logger,
    client,
    uploader,
    components: ['voice'],
  });

  return { config, db, repositories, bus, client, service, now };
}

describe('SyncService phase ordering', () => {
  it('does not advance past phase 1 when the manifest fails', async () => {
    const { repositories, client, service, db } = setup();
    client.manifestShouldFail = true;

    await service.runSyncCycle('session-1');

    const state = repositories.syncState.get('session-1')!;
    expect(state.manifestStatus).toBe('failed');
    expect(state.segmentsStatus).toBe('pending');
    expect(state.audioStatus).toBe('pending');
    expect(client.calls).not.toContain('presign');
    db.close();
  });

  it('does not start media (phase 3) until segments (phase 2) are drained', async () => {
    const { repositories, client, service, db, now } = setup();

    // An undelivered transcript segment blocks phase 2.
    repositories.relayQueue.enqueue({
      id: 'q-1',
      sessionId: 'session-1',
      segmentId: 'seg-1',
      sequence: 1,
      payloadJson: '{}',
      status: 'pending',
      attempts: 0,
      lastError: null,
      nextAttemptAt: now,
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await service.runSyncCycle('session-1');

    let state = repositories.syncState.get('session-1')!;
    expect(state.manifestStatus).toBe('confirmed');
    expect(state.segmentsStatus).toBe('in_progress');
    expect(state.audioStatus).toBe('pending');
    expect(client.calls).not.toContain('presign');

    // Drain the queue and run again — now all phases complete in order.
    repositories.relayQueue.markSent('q-1', now, now);
    await service.runSyncCycle('session-1');

    state = repositories.syncState.get('session-1')!;
    expect(state.segmentsStatus).toBe('synced');
    expect(state.audioStatus).toBe('complete');
    expect(state.syncComplete).toBe(1);
    expect(client.calls).toContain('presign');
    expect(client.calls).toContain('confirm');
    expect(client.calls).toContain('syncComplete');
    db.close();
  });

  it('runs the full four-phase cycle in order on a clean session', async () => {
    const { repositories, client, service, db } = setup();

    await service.runSyncCycle('session-1');

    const state = repositories.syncState.get('session-1')!;
    expect(state.manifestStatus).toBe('confirmed');
    expect(state.segmentsStatus).toBe('synced');
    expect(state.audioStatus).toBe('complete');
    expect(state.syncComplete).toBe(1);

    // manifest must come before presign, which must come before syncComplete.
    const manifestIdx = client.calls.indexOf('manifest');
    const presignIdx = client.calls.indexOf('presign');
    const completeIdx = client.calls.indexOf('syncComplete');
    expect(manifestIdx).toBeLessThan(presignIdx);
    expect(presignIdx).toBeLessThan(completeIdx);
    db.close();
  });
});
