import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRepositories, loadConfig, logger, openDatabase, StationEventBus } from '@pi-station/core';
import type Database from 'better-sqlite3';
import { VideoComponent } from '../src/components/video/VideoComponent.js';
import type { ComponentContext } from '../src/components/StationComponent.js';
import type { SessionSummary } from '../src/types.js';

function makeContext(root: string): ComponentContext {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATA_DIR: root,
    SQLITE_PATH: join(root, 'station.sqlite'),
    AUDIO_DIR: join(root, 'sessions'),
    VIDEO_DIR: join(root, 'sessions'),
    FACES_DIR: join(root, 'sessions'),
    REPORTS_DIR: join(root, 'reports'),
    VIDEO_SOURCE: 'mock',
    FACE_DETECTION: 'mock',
    PAN_TILT: 'mock',
  });

  const db = openDatabase(config);
  const repositories = createRepositories(db);
  const bus = new StationEventBus();

  return { config, repositories, bus, logger, dataDir: root };
}

const fakeSession: SessionSummary = {
  sessionId: 'test-vid-session',
  sessionCode: '999',
  title: 'Video Test',
  stationToken: 'tok',
  ingestUrl: 'http://localhost/ingest',
  startedAt: new Date().toISOString(),
  stoppedAt: null,
};

describe('VideoComponent lifecycle', () => {
  let root: string;
  let ctx: ComponentContext;
  let video: VideoComponent;
  let db: Database.Database;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pi-video-'));
    ctx = makeContext(root);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db = (ctx.repositories as any).sessions.db ?? openDatabase(ctx.config);
    video = new VideoComponent();
  });

  afterEach(async () => {
    await video.shutdown();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ctx.repositories as any).stationConfig.db.close();
    } catch {
      // Already closed
    }
  });

  it('initialises without throwing', async () => {
    await expect(video.init(ctx)).resolves.toBeUndefined();
  });

  it('starts a session and emits mock chunks', async () => {
    await video.init(ctx);
    await video.startSession(fakeSession);

    // Wait briefly for MockVideoSource to emit the first chunk
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    const status = video.getStatus();
    expect(status.id).toBe('video');
    expect(status.healthy).toBe(true);
    expect(status.buffering).toBe(false);

    await video.stopSession();
  });

  it('reports healthy = true and buffering = false after init', async () => {
    await video.init(ctx);
    const status = video.getStatus();
    expect(status.healthy).toBe(true);
    expect(status.buffering).toBe(false);
    expect(status.queuedItems).toBe(0);
  });

  it('enqueues video chunks in media_transfer_queue', async () => {
    await video.init(ctx);
    await video.startSession(fakeSession);

    // Wait for mock chunk emission
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    const queued = ctx.repositories.mediaTransfer.listBySession(fakeSession.sessionId, 'video');
    expect(queued.length).toBeGreaterThanOrEqual(1);
    expect(queued[0]?.mediaType).toBe('video');
    expect(queued[0]?.s3Key).toMatch(/vi-media\/sessions\/.+\/video\/chunk-\d+\.mp4/);

    await video.stopSession();
  });

  it('all lifecycle methods resolve without throwing', async () => {
    await video.init(ctx);
    await expect(video.startSession(fakeSession)).resolves.toBeUndefined();
    await expect(video.pause()).resolves.toBeUndefined();
    await expect(video.resume()).resolves.toBeUndefined();
    await expect(video.stopSession()).resolves.toBeUndefined();
    await expect(video.flush()).resolves.toBeUndefined();
    await expect(video.shutdown()).resolves.toBeUndefined();
  });

  it('contributeToReport returns valid section', async () => {
    await video.init(ctx);
    const section = video.contributeToReport(fakeSession);
    expect(section.id).toBe('video');
    expect(section.label).toBe('Video');
    expect(typeof section.summary).toBe('string');
    expect(Array.isArray(section.items)).toBe(true);
  });

  it('status detail includes source, detector, and panTilt', async () => {
    await video.init(ctx);
    const status = video.getStatus();
    expect(status.detail).toMatchObject({
      source: 'mock',
      detector: 'mock',
      panTilt: expect.objectContaining({ controller: 'mock' }),
    });
  });
});
