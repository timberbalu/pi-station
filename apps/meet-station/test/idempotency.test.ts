import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { createRepositories, loadConfig, openDatabase } from '@pi-station/core';

describe('relay idempotency', () => {
  it('stores a queued segment once per segment id', () => {
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

    const row = {
      id: 'queue-1',
      sessionId: 'session-1',
      segmentId: 'segment-1',
      sequence: 1,
      payloadJson: JSON.stringify({ hello: 'world' }),
      status: 'pending' as const,
      attempts: 0,
      lastError: null,
      nextAttemptAt: new Date().toISOString(),
      sentAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(repositories.relayQueue.enqueue(row)).toBe(true);
    expect(repositories.relayQueue.enqueue({ ...row, id: 'queue-2' })).toBe(false);
    expect(repositories.relayQueue.countByStatus('pending')).toBe(1);
    db.close();
  });
});
