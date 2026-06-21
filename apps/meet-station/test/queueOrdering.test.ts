import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { createRepositories, loadConfig, logger, openDatabase, StationEventBus } from '@pi-station/core';
import { RelayService } from '../src/relay/RelayService.js';
import type { IngestPayload, SessionSummary, TranscriptCommit } from '../src/types.js';

class FakeIngestClient {
  public accepted: number[] = [];
  private online = false;

  async send(payload: IngestPayload) {
    if (!this.online) {
      return { ok: false, status: 503, error: 'offline' };
    }

    this.accepted.push(payload.sequence);
    return { ok: true, status: 200, error: null };
  }

  isConnected(): boolean {
    return this.online;
  }

  getLastError(): string | null {
    return this.online ? null : 'offline';
  }

  goOnline(): void {
    this.online = true;
  }
}

describe('RelayService queue ordering', () => {
  it('flushes queued segments in sequence order', async () => {
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
    const ingest = new FakeIngestClient();
    const relay = new RelayService(
      config,
      repositories,
      ingest,
      new StationEventBus(),
      {
        onQueueBacklog: () => undefined,
        onQueueDrained: () => undefined,
      },
      logger,
    );
    const session: SessionSummary = {
      sessionId: 'session-1',
      sessionCode: '482913',
      title: 'Test',
      stationToken: 'token',
      ingestUrl: config.relay.ingestUrl,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
    };

    relay.setSession(session);

    const makeCommit = (sequence: number): TranscriptCommit => ({
      id: `segment-${sequence}`,
      sessionId: session.sessionId,
      sequence,
      provider: 'mock',
      startMs: sequence * 1000,
      endMs: sequence * 1000 + 900,
      text: `segment ${sequence}`,
      speakerLabel: 'Speaker',
      languageCode: 'en',
      confidence: 1,
      raw: {},
      committedAt: new Date().toISOString(),
    });

    await relay.handleCommittedSegment(makeCommit(1));
    await relay.handleCommittedSegment(makeCommit(2));
    await relay.handleCommittedSegment(makeCommit(3));

    expect(relay.getQueuedCount()).toBe(3);

    ingest.goOnline();
    await relay.flushOnce();

    expect(ingest.accepted).toEqual([1, 2, 3]);
    expect(relay.getQueuedCount()).toBe(0);
    db.close();
  });
});
