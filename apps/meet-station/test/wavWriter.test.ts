import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { createRepositories, loadConfig, logger, openDatabase } from '@pi-station/core';
import { WavChunkWriter } from '../src/capture/WavChunkWriter.js';

describe('WavChunkWriter', () => {
  it('writes a wav file and records metadata', async () => {
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
    const writer = new WavChunkWriter(config, repositories.audioChunks, logger);

    writer.startSession('session-1');
    writer.append({
      pcm: Buffer.alloc(3200),
      timestamp: new Date(),
      durationMs: 100,
    });
    writer.stop();

    const chunks = repositories.audioChunks.listBySession('session-1');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.bytes).toBe(3200);
    db.close();
  });
});
